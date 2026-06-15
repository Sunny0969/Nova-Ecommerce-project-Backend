/**
 * Replace breakfast (Cereals & Oats) products with Imtiaz saved HTML (as.htm).
 * Adds PRICE_MARKUP Rs to each imported price.
 *
 * Run:
 *   node scripts/importImtiazCerealsFromHtml.js
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

const SOURCE_FILES = [{ path: 'C:/Users/PC/Downloads/as.htm' }];
const CATEGORY_SLUG = 'breakfast';
const ID_PREFIX = 'imtiaz_cereal';
const PRICE_MARKUP = 20;

const BRAND_RULES = [
  ['Fauji', 'Fauji'],
  ['Weetabix', 'Weetabix'],
  ["Brio's", "Brio's"],
  ['Brios', "Brio's"],
  ['Ponam', 'Ponam'],
  ['Jenan', 'Jenan'],
  ['Nestle', 'Nestle'],
  ['Kellogg', 'Kellogg']
];

function extractSection(html) {
  const m = html.match(/<span style="color: rgb\(2, 55, 136\);">([^<]+)<\/span><\/li><\/ol>/);
  return m ? m[1].replace(/&amp;/g, '&') : 'Cereals & Oats';
}

function inferBrand(title) {
  const raw = String(title || '').trim();
  if (!raw) return 'Cereals & Oats';
  for (const [needle, label] of BRAND_RULES) {
    const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(esc, 'i').test(raw)) return label;
  }
  const first = raw.split(/\s+/)[0];
  if (first && first.length > 2 && /^[A-Za-z]/.test(first)) return first;
  return 'Cereals & Oats';
}

function skuFromImage(url) {
  const s = String(url || '');
  const code = s.match(/\/(EDG\d+|CFG\d+|CON\d+)\./i);
  if (code) return code[1].toUpperCase();
  const dish = s.match(/\/dish_image\/(\d+)\./i);
  if (dish) return `DISH_${dish[1]}`;
  const base = path.basename(s).replace(/\.[a-z0-9]+$/i, '');
  return base ? base.toUpperCase() : '';
}

function parseWeightFromTitle(title) {
  const t = String(title || '');
  const g = t.match(/(\d+(?:\.\d+)?)\s*g\b/i);
  if (g) {
    const n = Number(g[1]);
    return { weight: `${g[1]}g`, size: `${g[1]}g`, weightKg: n / 1000 };
  }
  const kg = t.match(/(\d+(?:\.\d+)?)\s*kg\b/i);
  if (kg) {
    const n = Number(kg[1]);
    return { weight: `${kg[1]}kg`, size: `${kg[1]}kg`, weightKg: n };
  }
  const sachets = t.match(/(\d+)\s*'?s\b/i);
  if (sachets) {
    return { weight: `${sachets[1]} pcs`, size: `${sachets[1]} pcs`, weightKg: null };
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
      const sku = skuFromImage(imageUrl) || skuFromImage(p.sku) || `ROW_${seen.size + 1}`;
      if (seen.has(sku)) continue;
      seen.add(sku);

      const basePrice = Number(p.offers?.price || p.offers?.[0]?.price || 0);
      if (!Number.isFinite(basePrice) || basePrice <= 0) continue;

      const name = String(p.name).replace(/\s+/g, ' ').trim();
      const description = String(p.description || name).trim();
      const weightFields = parseWeightFromTitle(name);

      products.push({
        name,
        sku,
        price: basePrice + PRICE_MARKUP,
        comparePrice: null,
        imageUrl: String(imageUrl).startsWith('http') ? imageUrl : '',
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
    console.log(`Parsed ${list.length} from ${path.basename(file.path)} (${section})`);
    for (const row of list) {
      if (seen.has(row.sku)) continue;
      seen.add(row.sku);
      merged.push(row);
    }
  }

  return merged;
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
  const cat = await Category.findOne({ slug: CATEGORY_SLUG, isActive: true });
  if (!cat) throw new Error(`Category "${CATEGORY_SLUG}" not found or inactive`);

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
      tags: [brand, row.section, 'Cereals & Oats'],
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
