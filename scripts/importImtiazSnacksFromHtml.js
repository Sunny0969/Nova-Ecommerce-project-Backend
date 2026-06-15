/**
 * Import products from saved Imtiaz category HTML (JSON-LD ItemList).
 *
 * Run:
 *   node scripts/importImtiazSnacksFromHtml.js
 *   node scripts/importImtiazSnacksFromHtml.js --file="C:/path/page.htm" --category=snacks-confectionary
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

const DEFAULT_FILES = [
  'C:/Users/PC/Downloads/Imtiaz - Online Shopping.htm',
  'C:/Users/PC/Downloads/Imtiaz - Online Shoppings.htm'
];
const DEFAULT_CATEGORY = 'snacks-confectionary';
const ID_PREFIX = 'imtiaz_snacks';

const BRAND_RULES = [
  ['Korneez', 'Korneez'],
  ['Kernel Pop', 'Kernel Pop'],
  ['Kernal Pop', 'Kernel Pop'],
  ['Candyland', 'Candyland'],
  ["Lay's", "Lay's"],
  ['Lays', "Lay's"],
  ['Cadbury', 'Cadbury'],
  ['Kinder Bueno', 'Kinder Bueno'],
  ['Kinder', 'Kinder'],
  ['Oreo', 'Oreo'],
  ['Peek Freans', 'Peek Freans']
];

function argValue(prefix) {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function inferBrand(title) {
  const raw = String(title || '').trim();
  if (!raw) return 'Snacks';
  for (const [needle, label] of BRAND_RULES) {
    const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(esc, 'i').test(raw)) return label;
  }
  const first = raw.split(/\s+/)[0];
  if (first && first.length > 2 && /^[A-Za-z]/.test(first)) return first;
  return 'Snacks';
}

function skuFromImage(url) {
  const s = String(url || '');
  const con = s.match(/\/(CON\d+)\./i);
  if (con) return con[1].toUpperCase();
  const edg = s.match(/\/(EDG\d+)\./i);
  if (edg) return edg[1].toUpperCase();
  const dish = s.match(/\/dish_image\/(\d+)\./i);
  if (dish) return `DISH_${dish[1]}`;
  const base = path.basename(s).replace(/\.[a-z0-9]+$/i, '');
  return base ? base.toUpperCase() : '';
}

function parseProductsFromHtml(html) {
  const products = [];
  const seen = new Set();
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];

  for (const block of blocks) {
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

      const price = Number(p.offers?.price || p.offers?.[0]?.price || 0);
      if (!Number.isFinite(price) || price <= 0) continue;

      products.push({
        name: String(p.name).replace(/\s+/g, ' ').trim(),
        sku,
        price,
        imageUrl: String(imageUrl).startsWith('http') ? imageUrl : '',
        description: String(p.description || p.name).trim()
      });
    }
  }

  return products;
}

function loadAllProducts(filePaths) {
  const merged = [];
  const seen = new Set();

  for (const file of filePaths) {
    if (!fs.existsSync(file)) {
      console.warn(`[skip] file not found: ${file}`);
      continue;
    }
    const list = parseProductsFromHtml(fs.readFileSync(file, 'utf8'));
    console.log(`Parsed ${list.length} from ${path.basename(file)}`);
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
  const categorySlug = argValue('--category=') || DEFAULT_CATEGORY;
  const fileArg = argValue('--file=');
  const files = fileArg ? [fileArg] : DEFAULT_FILES;

  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing in backend/.env');
  if (!ensureConfigured()) throw new Error('Cloudinary not configured in backend/.env');

  const products = loadAllProducts(files);
  if (!products.length) {
    console.error('No products found in HTML files.');
    process.exit(1);
  }

  console.log(`Total unique products: ${products.length}`);
  console.log(`Category slug: ${categorySlug}`);

  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  const cat = await Category.findOne({ slug: categorySlug, isActive: true });
  if (!cat) throw new Error(`Category "${categorySlug}" not found or inactive`);

  let created = 0;
  let updated = 0;
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
            folder: `nova-shop/products/${categorySlug}`
          });
        }
      } catch (e) {
        console.warn(`[img] ${productId}: ${e.message}`);
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
      comparePrice: null,
      images: uploadedImage ? [uploadedImage] : [],
      stock: 50,
      tags: [brand, 'Snacks & Confectionary'],
      isPublished: true,
      approvalStatus: 'approved'
    };

    const existing = await Product.findOne({ productId });
    if (existing) {
      await Product.updateOne({ _id: existing._id }, { $set: payload });
      updated += 1;
    } else {
      await Product.create(payload);
      created += 1;
    }

    console.log(`[${i + 1}/${products.length}] ${row.name} — Rs ${row.price}`);
  }

  const total = await Product.countDocuments({ category: cat._id, isPublished: true });
  console.log('Done.', { created, updated, fail, imported: products.length, categoryTotal: total });
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
