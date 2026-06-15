/**
 * Replace all spices-sauces products with Imtiaz saved HTML (w.htm).
 * Adds PRICE_MARKUP Rs to each imported price.
 *
 * Run:
 *   node scripts/importImtiazSpicesFromHtml.js
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

function extractSection(html) {
  const m = html.match(/<span style="color: rgb\(2, 55, 136\);">([^<]+)<\/span><\/li><\/ol>/);
  return m ? m[1].replace(/&amp;/g, '&') : '';
}

function imageUrlFromSku(sku) {
  if (!sku || sku.startsWith('ROW_') || sku.startsWith('DISH_')) return '';
  return `https://imtiaz-i.s3.ap-southeast-1.amazonaws.com/55126/gallery/${sku}.jpg`;
}

/** Captured from Imtiaz Salt, Spices & Herbs page when HTML save mismatches. */
const SPICE_FALLBACK = [
  { name: 'Ponam Chilli Crushed 200g', sku: 'CFG150000053', basePrice: 169 },
  { name: 'Ponam Garam Masala Powder 100g', sku: 'CFG150000097', basePrice: 295 },
  { name: 'Ponam Black Peper Powder 100g', sku: 'CFG150000023', basePrice: 299 },
  { name: 'Ponam Haldi Powder 200g', sku: 'CFG150000109', basePrice: 195 },
  { name: 'Ponam Chilli Crushed 100g', sku: 'CFG150000052', basePrice: 89 },
  { name: 'Ponam Chilli Crushed 500g', sku: 'CFG150000054', basePrice: 399 },
  { name: 'Ponam Haldi Powder 400g', sku: 'CFG150000110', basePrice: 379 },
  { name: 'Ponam White Pepper Powder 50g', sku: 'CFG150000215', basePrice: 189 },
  { name: 'Ponam Black Peper Powder 50g', sku: 'CFG150000024', basePrice: 155 },
  { name: 'Ponam Chat Masala 200g', sku: 'CFG150000051', basePrice: 199 },
  { name: 'Ponam Kachri Powder 100g', sku: 'CFG150000134', basePrice: 149 },
  { name: 'Zeera White Powder 50g', sku: 'CFG150000221', basePrice: 99 },
  { name: 'Ponam Jaifal Powder 50G', sku: 'CFG150000127', basePrice: 215 },
  { name: 'Ponam Mustard Seeds (Rai Dana) Powder 100G', sku: 'CFG150000158', basePrice: 59 }
];
const CATEGORY_SLUG = 'spices-sauces';
const SOURCE_FILES = [{ path: 'C:/Users/PC/Downloads/w.htm' }];
const ID_PREFIX = 'imtiaz_spice';
const PRICE_MARKUP = 10;
const SECTION_LABEL = 'Salt, Spices & Herbs';

const BRAND_RULES = [
  ['Ponam', 'Ponam'],
  ['National', 'National'],
  ['Shan', 'Shan'],
  ['Knorr', 'Knorr'],
  ['Mehran', 'Mehran']
];

function inferBrand(title) {
  const raw = String(title || '').trim();
  if (!raw) return 'Spices';
  for (const [needle, label] of BRAND_RULES) {
    const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(esc, 'i').test(raw)) return label;
  }
  const first = raw.split(/\s+/)[0];
  if (first && first.length > 2 && /^[A-Za-z]/.test(first)) return first;
  return 'Spices';
}

function skuFromImage(url) {
  const s = String(url || '');
  const code = s.match(/\/(CFG\d+|EDG\d+|CON\d+)\./i);
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
        imageUrl: String(imageUrl).startsWith('http') ? imageUrl : imageUrlFromSku(sku),
        description,
        section,
        ...weightFields
      });
    }
  }

  return products;
}

function loadFallbackProducts() {
  return SPICE_FALLBACK.map((row) => {
    const weightFields = parseWeightFromTitle(row.name);
    return {
      name: row.name,
      sku: row.sku,
      price: row.basePrice + PRICE_MARKUP,
      comparePrice: null,
      imageUrl: imageUrlFromSku(row.sku),
      description: row.name,
      section: SECTION_LABEL,
      ...weightFields
    };
  });
}

function isSpiceSection(section) {
  return /salt|spice|herb/i.test(String(section || ''));
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
    const section = extractSection(html) || SECTION_LABEL;
    let list = parseProductsFromHtml(html, section);

    if (!list.length || !isSpiceSection(section)) {
      console.warn(
        `[fallback] ${path.basename(file.path)} section="${section}" — using Salt, Spices & Herbs list (${SPICE_FALLBACK.length} items)`
      );
      list = loadFallbackProducts();
    }

    console.log(`Parsed ${list.length} from ${path.basename(file.path)} (${list[0]?.section || section})`);
    for (const row of list) {
      if (seen.has(row.sku)) continue;
      seen.add(row.sku);
      merged.push(row);
    }
  }

  if (!merged.length) {
    return loadFallbackProducts();
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
      tags: [brand, row.section, 'Salt, Spices & Herbs'],
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
