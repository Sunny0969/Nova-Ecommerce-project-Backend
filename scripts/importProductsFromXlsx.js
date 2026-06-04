/**
 * Generic Excel → Products importer.
 *
 * Works for any category by slug and any Excel file that matches the columns:
 * - Product Title
 * - SKU
 * - Description
 * - Sale Price (PKR)
 * - Original Price (PKR)
 * - Availability
 * - Product URL
 * - Unsplash Image URL  (preferred)
 * - Image URL (CDN)     (fallback)
 *
 * It uploads the image to Cloudinary and stores `{ url, public_id }` in `Product.images[]`.
 * It avoids duplication by using a stable `Product.productId` (default: `${idPrefix}_${SKU}`).
 *
 * Run:
 *   node scripts/importProductsFromXlsx.js --file="C:/path/file.xlsx" --category="baby-care"
 *
 * Optional:
 *   --sheet="Sheet Name"
 *   --idPrefix="khareedo"
 *   --limit=50
 *   --update
 *   --tags-only   (with --update: only set tags from Excel "Category" column, skip images/prices)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const xlsx = require('xlsx');

const Category = require('../models/Category');
const Product = require('../models/Product');
const { ensureConfigured, uploadImageBuffer } = require('../lib/cloudinary');

function argFlag(name) {
  return process.argv.includes(name);
}

function argValue(prefix) {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (!hit) return null;
  const [, v] = hit.split('=');
  return v == null ? null : v;
}

function normalizeString(v) {
  return String(v == null ? '' : v).trim();
}

function parseNumber(v) {
  if (typeof v === 'number') return v;
  const s = normalizeString(v);
  if (!s) return NaN;
  const cleaned = s.replace(/,/g, '').replace(/[^\d.]+/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function downloadToBuffer(url, opts = {}) {
  const u = normalizeString(url);
  if (!u) return null;

  const timeoutMs = Number(opts.timeoutMs) || 15000;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(u, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
      }
    });
    if (!res.ok) throw new Error(`Image download failed (${res.status})`);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } finally {
    clearTimeout(t);
  }
}

async function downloadImageWithRetry(primaryUrl, fallbackUrl) {
  const urls = [normalizeString(primaryUrl), normalizeString(fallbackUrl)].filter(Boolean);
  let lastErr = null;

  for (const u of urls) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const buf = await downloadToBuffer(u, { timeoutMs: 20000 });
        if (buf && buf.length) return buf;
      } catch (e) {
        lastErr = e;
        await sleep(450 * Math.pow(2, attempt));
      }
    }
  }

  if (lastErr) throw lastErr;
  return null;
}

function makeShortDescription(row) {
  return (
    normalizeString(row['Description']) ||
    normalizeString(row['Product Title']) ||
    ''
  ).slice(0, 500);
}

function makeDescription(row) {
  const parts = [];
  const title = normalizeString(row['Product Title']);
  const desc = normalizeString(row['Description']);
  const source = normalizeString(row['Product URL']);
  if (title) parts.push(title);
  if (desc && desc !== title) parts.push(desc);
  if (source) parts.push(`Source: ${source}`);
  return parts.join('\n\n');
}

async function withConcurrency(items, limit, worker) {
  const out = { ok: 0, fail: 0 };
  let i = 0;
  const runOne = async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      try {
        await worker(items[idx], idx);
        out.ok += 1;
      } catch (e) {
        out.fail += 1;
        const msg = e && e.message ? e.message : String(e);
        console.error(`[FAIL] row#${idx + 1}: ${msg}`);
      }
    }
  };
  const runners = Array.from({ length: Math.max(1, limit) }).map(() => runOne());
  await Promise.all(runners);
  return out;
}

async function main() {
  const file = argValue('--file=');
  const categorySlug = argValue('--category=');
  if (!file || !categorySlug) {
    console.error('Missing required args. Example: --file="C:/path.xlsx" --category="baby-care"');
    process.exit(1);
  }

  const sheetArg = argValue('--sheet=');
  const idPrefix = argValue('--idPrefix=') || String(categorySlug).replace(/-/g, '');
  const updateExisting = argFlag('--update');
  const tagsOnly = argFlag('--tags-only');
  const limitArg = argValue('--limit=');
  const rowLimit = limitArg ? Math.max(1, Number(limitArg)) : null;

  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) {
    console.error('MONGODB_URI is not set. Add it to backend/.env');
    process.exit(1);
  }
  if (!ensureConfigured()) {
    console.error(
      'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET in backend/.env'
    );
    process.exit(1);
  }

  const wb = xlsx.readFile(file);
  const sheetName = sheetArg && wb.SheetNames.includes(sheetArg) ? sheetArg : wb.SheetNames[0];
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
  const list = rowLimit ? rows.slice(0, rowLimit) : rows;

  await mongoose.connect(MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  console.log('Connected to MongoDB');
  console.log(`File: ${file}`);
  console.log(`Sheet: ${sheetName} | Rows: ${rows.length} | Processing: ${list.length}`);
  console.log(
    `Category: ${categorySlug} | idPrefix: ${idPrefix} | updateExisting: ${updateExisting} | tagsOnly: ${tagsOnly}`
  );

  const cat = await Category.findOne({ slug: categorySlug, isActive: true });
  if (!cat) {
    console.error(`Category slug "${categorySlug}" not found (or inactive).`);
    process.exit(1);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  const concurrency = 3;
  const stats = await withConcurrency(list, concurrency, async (row, idx) => {
    const name = normalizeString(row['Product Title']);
    const sku = normalizeString(row['SKU']);
    const productId = sku ? `${idPrefix}_${sku}` : `${idPrefix}_row_${idx + 1}`;
    if (!name) throw new Error('Missing Product Title');

    const price = parseNumber(row['Sale Price (PKR)']);
    const comparePrice = parseNumber(row['Original Price (PKR)']);
    if (!Number.isFinite(price)) throw new Error('Invalid Sale Price (PKR)');

    const availability = normalizeString(row['Availability']).toLowerCase();
    const inStock = availability.includes('in stock') || availability.includes('available');
    const stock = inStock ? 50 : 0;

    const subCategory = normalizeString(row.Category);
    const tags = subCategory ? [subCategory] : [];

    const existing = await Product.findOne({ productId });
    if (existing && tagsOnly) {
      await Product.updateOne({ _id: existing._id }, { $set: { tags } });
      updated += 1;
      if ((skipped + created + updated) % 25 === 0) {
        console.log(`[progress] created=${created} updated=${updated} skipped=${skipped}`);
      }
      return;
    }

    if (existing && !updateExisting) {
      skipped += 1;
      if ((skipped + created + updated) % 25 === 0) {
        console.log(`[progress] created=${created} updated=${updated} skipped=${skipped}`);
      }
      return;
    }

    let uploadedImage = null;
    const unsplashUrl = normalizeString(row['Unsplash Image URL']);
    const cdnUrl = normalizeString(row['Image URL (CDN)']);
    try {
      const buffer = await downloadImageWithRetry(unsplashUrl, cdnUrl);
      if (buffer && buffer.length > 0) {
        uploadedImage = await uploadImageBuffer(buffer, {
          folder: `nova-shop/products/${categorySlug}`
        });
      }
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      console.warn(`[WARN] image skipped for ${productId}: ${msg}`);
    }

    const payload = {
      name,
      productId,
      sku,
      category: cat._id,
      shortDescription: makeShortDescription(row),
      description: makeDescription(row),
      price,
      comparePrice: Number.isFinite(comparePrice) && comparePrice > price ? comparePrice : null,
      images: uploadedImage ? [uploadedImage] : [],
      stock,
      tags,
      isPublished: true,
      approvalStatus: 'approved'
    };

    if (existing) {
      await Product.updateOne({ _id: existing._id }, { $set: payload });
      updated += 1;
    } else {
      await Product.create(payload);
      created += 1;
    }

    if ((skipped + created + updated) % 25 === 0) {
      console.log(`[progress] created=${created} updated=${updated} skipped=${skipped}`);
    }
  });

  console.log('Done.');
  console.log({ created, updated, skipped, ok: stats.ok, fail: stats.fail });
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

