/**
 * Replace all personal-hygiene products with Imtiaz saved HTML.
 * Creates category if missing. Adds PRICE_MARKUP Rs to each imported price.
 *
 * Run:
 *   node scripts/importImtiazPersonalHygieneFromHtml.js
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { ensureConfigured, uploadImageBuffer } = require('../lib/cloudinary');

const SOURCE_FILES = [
  { path: 'C:/Users/PC/Downloads/a.htm' },
  { path: 'C:/Users/PC/Downloads/aa.htm' },
  { path: 'C:/Users/PC/Downloads/aaa.htm' },
  { path: 'C:/Users/PC/Downloads/aaaa.htm' },
  { path: 'C:/Users/PC/Downloads/aaaaa.htm' }
];
const CATEGORY_SLUG = 'personal-hygiene';
const CATEGORY_NAME = 'Personal Hygiene';
const ID_PREFIX = 'imtiaz_hygiene';
const PRICE_MARKUP = 10;

const BRAND_RULES = [
  ['Dettol', 'Dettol'],
  ['Lifebuoy', 'Lifebuoy'],
  ['Safeguard', 'Safeguard'],
  ['Protex', 'Protex'],
  ['Lux', 'Lux'],
  ['Capri', 'Capri'],
  ['Palmolive', 'Palmolive'],
  ['Pears', 'Pears'],
  ['Oasis', 'Oasis'],
  ['Caresse', 'Caresse'],
  ['Dupas', 'Dupas'],
  ['Tibet', 'Tibet'],
  ['Cool & Cool', 'Cool & Cool'],
  ["Tip Top's", "Tip Top's"],
  ['Fay', 'Fay']
];

function extractSection(html) {
  const m = html.match(/<span style="color: rgb\(2, 55, 136\);">([^<]+)<\/span><\/li><\/ol>/);
  return m ? m[1].replace(/&amp;/g, '&') : CATEGORY_NAME;
}

function inferBrand(title) {
  const raw = String(title || '').trim();
  if (!raw) return 'Personal Hygiene';
  for (const [needle, label] of BRAND_RULES) {
    const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(esc, 'i').test(raw)) return label;
  }
  const first = raw.split(/\s+/)[0];
  if (first && first.length > 2 && /^[A-Za-z]/.test(first)) return first;
  return 'Personal Hygiene';
}

function skuFromImage(url) {
  const s = String(url || '');
  const code = s.match(/\/(HBY\d+|BBW\d+|EDG\d+|DAI\d+|CND\d+|CFG\d+|CON\d+)\./i);
  if (code) return code[1].toUpperCase();
  const dish = s.match(/\/dish_image\/(\d+)\./i);
  if (dish) return `DISH_${dish[1]}`;
  const base = path.basename(s).replace(/\.[a-z0-9]+$/i, '');
  if (/^\d+$/.test(base)) return `DISH_${base}`;
  return base ? base.toUpperCase() : '';
}

function imageUrlFromSku(sku) {
  if (!sku || sku.startsWith('ROW_')) return '';
  if (sku.startsWith('DISH_')) {
    const id = sku.replace(/^DISH_/, '');
    return `https://imtiaz-i.s3.ap-southeast-1.amazonaws.com/55126/dish_image/${id}.jpg`;
  }
  return `https://imtiaz-i.s3.ap-southeast-1.amazonaws.com/55126/gallery/${sku}.jpg`;
}

function parseWeightFromTitle(title) {
  const t = String(title || '');
  const ml = t.match(/(\d+(?:\.\d+)?)\s*ml\b/i);
  if (ml) {
    const n = Number(ml[1]);
    return { weight: `${ml[1]}ml`, size: `${ml[1]}ml`, weightKg: n / 1000 };
  }
  const g = t.match(/(\d+(?:\.\d+)?)\s*g\b/i);
  if (g) {
    const n = Number(g[1]);
    return { weight: `${g[1]}g`, size: `${g[1]}g`, weightKg: n / 1000 };
  }
  return { weight: '', size: '', weightKg: null };
}

function parseProductsFromHtml(html, section) {
  const products = [];
  const seen = new Set();

  for (const block of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let data;
    try {
      data = JSON.parse(block[1]);
    } catch {
      continue;
    }
    if (data['@type'] !== 'ItemList' || !Array.isArray(data.itemListElement)) continue;

    for (const el of data.itemListElement) {
      const p = el.item || el;
      if (!p?.name) continue;

      const imageUrl = Array.isArray(p.image) ? p.image[0] : p.image || '';
      const sku = skuFromImage(imageUrl) || skuFromImage(p.sku) || `ROW_${section}_${seen.size + 1}`;
      if (seen.has(sku)) continue;
      seen.add(sku);

      const basePrice = Number(p.offers?.price || p.offers?.[0]?.price || 0);
      if (!Number.isFinite(basePrice) || basePrice <= 0) continue;

      const name = String(p.name).replace(/\s+/g, ' ').trim();
      const description = String(p.description || name).trim();
      const weightFields = parseWeightFromTitle(name);
      const resolvedImage =
        String(imageUrl).startsWith('http') ? imageUrl : imageUrlFromSku(sku);

      products.push({
        name,
        sku,
        price: basePrice + PRICE_MARKUP,
        comparePrice: null,
        imageUrl: resolvedImage,
        description,
        section,
        ...weightFields
      });
    }
  }

  return products;
}

function loadAllProducts() {
  const merged = [];
  const seen = new Set();

  for (const file of SOURCE_FILES) {
    if (!fs.existsSync(file.path)) {
      console.warn(`[skip] file not found: ${file.path}`);
      continue;
    }
    const html = fs.readFileSync(file.path, 'utf8');
    const section = extractSection(html);
    const list = parseProductsFromHtml(html, section);
    console.log(`Parsed ${list.length} from ${path.basename(file.path)} (${section || 'no section'})`);
    if (!list.length && fs.statSync(file.path).size < 50000) {
      console.warn(
        `[hint] ${path.basename(file.path)} may be incomplete — re-save after products load (~100KB+)`
      );
    }
    for (const row of list) {
      if (seen.has(row.sku)) continue;
      seen.add(row.sku);
      merged.push(row);
    }
  }

  return merged;
}

async function ensureCategory() {
  let cat = await Category.findOne({ slug: CATEGORY_SLUG });
  if (cat) {
    if (!cat.isActive) {
      cat.isActive = true;
      await cat.save();
    }
    return cat;
  }

  cat = await Category.create({
    name: CATEGORY_NAME,
    slug: CATEGORY_SLUG,
    description: 'Soaps, hand wash, wipes, cotton buds, and hygiene essentials',
    displayOrder: 17,
    isActive: true,
    image: {
      url: 'https://images.unsplash.com/photo-1583947215259-38e31be8751f?w=640&auto=format&fit=crop&q=80',
      public_id: ''
    }
  });
  console.log(`Created category "${CATEGORY_NAME}" (${CATEGORY_SLUG})`);
  return cat;
}

async function download(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      Accept: 'image/*',
      'User-Agent': 'Mozilla/5.0 (compatible; BazaarImporter/1.0)'
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing in backend/.env');
  if (!ensureConfigured()) throw new Error('Cloudinary not configured in backend/.env');

  const products = loadAllProducts();
  if (!products.length) {
    console.error('No products found in HTML files.');
    process.exit(1);
  }

  console.log(`Total unique products: ${products.length}`);
  console.log(`Category slug: ${CATEGORY_SLUG}`);
  console.log(`Price markup: +${PRICE_MARKUP} Rs per product`);

  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  const cat = await ensureCategory();

  const removed = await Product.deleteMany({ category: cat._id });
  console.log(`Removed ${removed.deletedCount} existing products.`);

  let created = 0;
  let fail = 0;

  for (let i = 0; i < products.length; i++) {
    const row = products[i];
    const brand = inferBrand(row.name);
    const productId = `${ID_PREFIX}_${row.sku}`;
    const shortDescription = row.description.slice(0, 500);

    let uploadedImage = null;
    if (row.imageUrl) {
      try {
        const buf = await download(row.imageUrl);
        if (buf.length) {
          uploadedImage = await uploadImageBuffer(buf, {
            folder: `nova-shop/products/${CATEGORY_SLUG}`
          });
        }
      } catch (e) {
        console.warn(`[img] ${productId}: ${e.message}`);
        fail += 1;
      }
      await sleep(150);
    }

    const payload = {
      name: row.name,
      productId,
      sku: row.sku,
      category: cat._id,
      shortDescription,
      description: row.description,
      price: row.price,
      comparePrice: row.comparePrice,
      weight: row.weight || undefined,
      size: row.size || undefined,
      weightKg: row.weightKg ?? undefined,
      images: uploadedImage ? [uploadedImage] : [],
      stock: 50,
      tags: [brand, row.section, CATEGORY_NAME],
      isPublished: true,
      approvalStatus: 'approved'
    };

    await Product.create(payload);
    created += 1;
    console.log(
      `[${i + 1}/${products.length}] ${row.name} — Rs ${row.price}${row.weight ? ` (${row.weight})` : ''}`
    );
  }

  const total = await Product.countDocuments({ category: cat._id, isPublished: true });
  console.log('Done.', { created, fail, imported: products.length, categoryTotal: total });
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
