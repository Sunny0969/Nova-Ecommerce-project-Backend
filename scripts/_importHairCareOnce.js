/** One-off — delete after run */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { ensureConfigured, uploadImageBuffer } = require('../lib/cloudinary');

const HTML_FILE = 'C:/Users/PC/Desktop/Buy Hair Care Online in Pakistan at Best Prices.htm';
const CATEGORY_SLUG = 'hair-care';
const ID_PREFIX = 'haircare';

const BRAND_RULES = [
  ['Head & Shoulders', 'Head & Shoulders'],
  ['Herbal Essences', 'Herbal Essences'],
  ['Saeed Ghani', 'Saeed Ghani'],
  ['CoNatural', 'Conatural'],
  ['Conatural', 'Conatural'],
  ['Schwarzkopf', 'Schwarzkopf'],
  ['Zo\'Nanos', "Zo'Nanos"],
  ['ZoNanos', "Zo'Nanos"],
  ['L\'Oreal', "L'Oreal"],
  ['Loreal', "L'Oreal"],
  ['Clinic Plus', 'Clinic Plus'],
  ['Herbal Essences', 'Herbal Essences'],
  ['Head and Shoulders', 'Head & Shoulders'],
  ['Got2b', 'Got2b'],
  ['Jenpharm', 'Jenpharm'],
  ['Kalakola', 'Kalakola'],
  ['Meclay', 'Meclay'],
  ['Palmolive', 'Palmolive'],
  ['Keune', 'Keune'],
  ['Hemani', 'Hemani'],
  ['Selsun', 'Selsun'],
  ['Samsol', 'Samsol'],
  ['Revlon', 'Revlon'],
  ['Vince', 'Vince'],
  ['Just', 'Just'],
  ['Pantene', 'Pantene'],
  ['Suave', 'Suave'],
  ['Dabur', 'Dabur'],
  ['Garnier', 'Garnier'],
  ['Vatika', 'Vatika'],
  ['Olivia', 'Olivia'],
  ['Nivea', 'Nivea'],
  ['Dove', 'Dove'],
  ['SunSilk', 'SunSilk'],
  ['Sunsilk', 'SunSilk'],
  ['Tresemme', 'Tresemme'],
  ['TRESemme', 'Tresemme'],
  ['Clear', 'Clear'],
  ['Himalaya', 'Himalaya'],
  ['OGX', 'OGX'],
  ['Bio', 'Bio']
];

function unescapeJsonStr(s) {
  return String(s || '')
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .trim();
}

function inferBrand(title) {
  const raw = String(title || '').trim();
  if (!raw) return 'Other';
  for (const [needle, label] of BRAND_RULES) {
    const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${esc}\\b`, 'i').test(raw)) return label;
  }
  const first = raw.split(/\s+/)[0];
  if (first && first.length > 2 && /^[A-Za-z]/.test(first)) return first;
  return 'Other';
}

function resolvePrices({ actualPrice, discountedPrice, retailPrice, schemaPrice }) {
  const actual = Number.isFinite(actualPrice) ? actualPrice : Number(schemaPrice);
  const disc = Number(discountedPrice) || 0;
  const retail = Number(retailPrice) || 0;
  if (!Number.isFinite(actual) || actual <= 0) return null;

  if (disc > 0 && actual > disc) {
    return { price: disc, comparePrice: actual };
  }
  if (retail > actual) {
    return { price: actual, comparePrice: retail };
  }
  return { price: actual, comparePrice: null };
}

function parseSchemaProducts(html) {
  const m = html.match(/<script id="item-list-schema" type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('item-list-schema not found');
  const data = JSON.parse(m[1]);
  return data.itemListElement.map((el) => {
    const p = el.item;
    return {
      name: p.name,
      description: p.description || p.name,
      sku: p.sku,
      imageUrl: p.image,
      category: p.category,
      url: p.url,
      schemaPrice: Number(p.offers?.price)
    };
  });
}

function parseRscBySku(html) {
  const map = new Map();
  const skus = [...html.matchAll(/\\"sku\\":\\"(FM-[^\\]+)\\"/g)].map((x) => x[1]);
  for (const sku of skus) {
    const marker = `\\"sku\\":\\"${sku}\\"`;
    const pos = html.indexOf(marker);
    if (pos === -1) continue;
    const before = html.slice(Math.max(0, pos - 900), pos);
    const after = html.slice(pos, pos + 2500);

    const titleM = before.match(/\\"title\\":\\"((?:[^"\\]|\\.)*)\\",\\"vendor\\"/);
    const descM = after.match(/\\"description\\":\\"((?:[^"\\]|\\.)*)\\",\\"actualPrice\\"/);
    const actualM = after.match(/\\"actualPrice\\":(\d+)/);
    const discM = after.match(/\\"discountedPrice\\":(\d+)/);
    const retailM = after.match(/\\"retailPrice\\":(\d+)/);
    const imgM = after.match(/\\"imageUrl\\":\\"(https:[^\\]+)\\"/);

    map.set(sku, {
      title: titleM ? unescapeJsonStr(titleM[1]) : '',
      description: descM ? unescapeJsonStr(descM[1]) : '',
      actualPrice: actualM ? Number(actualM[1]) : null,
      discountedPrice: discM ? Number(discM[1]) : 0,
      retailPrice: retailM ? Number(retailM[1]) : 0,
      imageUrl: imgM ? imgM[1] : ''
    });
  }
  return map;
}

async function download(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      Accept: 'image/*',
      'User-Agent': 'Mozilla/5.0 (compatible; NovaShopImporter/1.0)'
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing');
  if (!ensureConfigured()) throw new Error('Cloudinary not configured');

  const html = fs.readFileSync(HTML_FILE, 'utf8');
  const schema = parseSchemaProducts(html);
  const rscMap = parseRscBySku(html);
  console.log(`Schema: ${schema.length} | RSC detail: ${rscMap.size}`);

  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  const cat = await Category.findOne({ slug: CATEGORY_SLUG, isActive: true });
  if (!cat) throw new Error(`Category ${CATEGORY_SLUG} not found`);

  let created = 0;
  let updated = 0;
  let fail = 0;

  for (let i = 0; i < schema.length; i++) {
    const row = schema[i];
    const extra = rscMap.get(row.sku) || {};
    const name = extra.title || row.name;
    const description = extra.description || row.description || name;
    const shortDescription = description.slice(0, 500);
    const imageUrl = extra.imageUrl || row.imageUrl;

    const prices = resolvePrices({
      actualPrice: extra.actualPrice,
      discountedPrice: extra.discountedPrice,
      retailPrice: extra.retailPrice,
      schemaPrice: row.schemaPrice
    });
    if (!prices) {
      fail += 1;
      console.warn(`[skip] ${row.sku}: bad price`);
      continue;
    }

    const brand = inferBrand(name);
    const tags = [brand];
    const productId = `${ID_PREFIX}_${row.sku}`;

    let uploadedImage = null;
    if (imageUrl) {
      try {
        const buf = await download(imageUrl);
        if (buf.length) {
          uploadedImage = await uploadImageBuffer(buf, { folder: `nova-shop/products/${CATEGORY_SLUG}` });
        }
      } catch (e) {
        console.warn(`[img] ${productId}: ${e.message}`);
      }
      await sleep(120);
    }

    const payload = {
      name,
      productId,
      sku: row.sku,
      category: cat._id,
      shortDescription,
      description: [description, row.url ? `Source: ${row.url}` : ''].filter(Boolean).join('\n\n'),
      price: prices.price,
      comparePrice: prices.comparePrice,
      images: uploadedImage ? [uploadedImage] : [],
      stock: 50,
      tags,
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

    if ((i + 1) % 15 === 0) {
      console.log(`[${i + 1}/${schema.length}] created=${created} updated=${updated} fail=${fail}`);
    }
  }

  const tagCounts = await Product.aggregate([
    { $match: { category: cat._id, isPublished: true } },
    { $unwind: '$tags' },
    { $group: { _id: '$tags', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);

  console.log('Done.', { created, updated, fail, total: schema.length });
  console.log('Brand tags:', tagCounts);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
