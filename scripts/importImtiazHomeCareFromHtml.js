/**
 * Replace all home-care products with Imtiaz saved HTML pages.
 * Adds PRICE_MARKUP Rs to each imported price. Assigns shop subcategories after import.
 *
 * Run (default file paths — save Imtiaz category pages as these names in Downloads):
 *   node scripts/importImtiazHomeCareFromHtml.js
 *
 * Custom files:
 *   node scripts/importImtiazHomeCareFromHtml.js --file="C:/path/laundry.htm" --section="Laundry"
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const ProductSubcategory = require('../models/ProductSubcategory');
const { ensureConfigured, uploadImageBuffer } = require('../lib/cloudinary');
const { assignCategorySubcategories } = require('../lib/assignCategorySubcategories');
const { syncCategoryVisibility } = require('../lib/syncCategoryVisibility');
const { resolveHomeCareSubcategorySlug } = require('../lib/homeCareSubcategories');

const DEFAULT_SOURCE_FILES = [
  { path: 'C:/Users/PC/Downloads/hc-laundry.htm', section: 'Laundry' },
  { path: 'C:/Users/PC/Downloads/hc-cleaning.htm', section: 'Cleaning' },
  { path: 'C:/Users/PC/Downloads/hc-disposable.htm', section: 'Disposable' },
  { path: 'C:/Users/PC/Downloads/hc-tissue.htm', section: 'Tissue' },
  { path: 'C:/Users/PC/Downloads/hc-air-fresheners.htm', section: 'Air Fresheners & Home Fragrances' },
  { path: 'C:/Users/PC/Downloads/hc-pest-control.htm', section: 'Pest Control' }
];

const CATEGORY_SLUG = 'home-care';
const CATEGORY_NAME = 'Home Care';
const ID_PREFIX = 'imtiaz_home';
const PRICE_MARKUP = 10;

const SECTION_SUB_SLUG = {
  laundry: 'laundry',
  cleaning: 'cleaning',
  disposable: 'disposable',
  tissue: 'tissue',
  'air fresheners & home fragrances': 'air-fresheners-home-fragrances',
  'air fresheners': 'air-fresheners-home-fragrances',
  'pest control': 'pest-control'
};

const BRAND_RULES = [
  ['Ariel', 'Ariel'],
  ['Dettol', 'Dettol'],
  ['Harpic', 'Harpic'],
  ['Vim', 'Vim'],
  ['Comfort', 'Comfort'],
  ['Vanish', 'Vanish'],
  ['Spontex', 'Spontex'],
  ['Masafi', 'Masafi'],
  ['Fay', 'Fay'],
  ['Hankies', 'Hankies'],
  ['Rose Petal', 'Rose Petal'],
  ['Brite', 'Brite'],
  ['Tez Clean', 'Tez Clean'],
  ['Max', 'Max'],
  ['Astonish', 'Astonish'],
  ['Frey', 'Frey'],
  ['Perfect', 'Perfect'],
  ['Robin', 'Robin'],
  ['Sufi', 'Sufi'],
  ['Persil', 'Persil'],
  ['Diamond', 'Diamond'],
  ['Mortein', 'Mortein'],
  ['Mospel', 'Mospel']
];

function parseCliFiles() {
  const args = process.argv.slice(2);
  const files = [];
  let pendingSection = '';

  for (const arg of args) {
    if (arg.startsWith('--section=')) {
      pendingSection = arg.slice('--section='.length).trim();
      continue;
    }
    if (arg.startsWith('--file=')) {
      files.push({
        path: arg.slice('--file='.length).trim(),
        section: pendingSection || ''
      });
      pendingSection = '';
    }
  }

  return files.length ? files : DEFAULT_SOURCE_FILES;
}

function extractSection(html) {
  const m = html.match(/<span style="color: rgb\(2, 55, 136\);">([^<]+)<\/span><\/li><\/ol>/);
  return m ? m[1].replace(/&amp;/g, '&').trim() : '';
}

function inferBrand(title) {
  const raw = String(title || '').trim();
  if (!raw) return 'Home Care';
  for (const [needle, label] of BRAND_RULES) {
    const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(esc, 'i').test(raw)) return label;
  }
  const first = raw.split(/\s+/)[0];
  if (first && first.length > 2 && /^[A-Za-z]/.test(first)) return first;
  return 'Home Care';
}

function skuFromImage(url) {
  const s = String(url || '');
  const code = s.match(/\/(FM\d+|CO\d+|HBY\d+|BBW\d+|DAI\d+|EDG\d+|CND\d+|CFG\d+|CON\d+)\./i);
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
  const ltr = t.match(/(\d+(?:\.\d+)?)\s*ltr\b/i);
  if (ltr) {
    const n = Number(ltr[1]);
    return { weight: `${ltr[1]}L`, size: `${ltr[1]}L`, weightKg: n };
  }
  const l = t.match(/(\d+(?:\.\d+)?)\s*l\b/i);
  if (l) {
    const n = Number(l[1]);
    return { weight: `${l[1]}L`, size: `${l[1]}L`, weightKg: n };
  }
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

function resolveSubSlug(section, productName) {
  const key = String(section || '').trim().toLowerCase();
  if (SECTION_SUB_SLUG[key]) return SECTION_SUB_SLUG[key];
  return resolveHomeCareSubcategorySlug(productName);
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
      let sku = skuFromImage(imageUrl) || skuFromImage(p.sku) || `ROW_${section}_${seen.size + 1}`;
      if (/^FM\d+$/i.test(sku)) sku = `FM-${sku.slice(2)}`;
      if (/^CO\d+$/i.test(sku)) sku = `CO-${sku.slice(2)}`;
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
        subSlug: resolveSubSlug(section, name),
        ...weightFields
      });
    }
  }

  return products;
}

function loadAllProducts(sourceFiles) {
  const merged = [];
  const seen = new Set();

  for (const file of sourceFiles) {
    if (!fs.existsSync(file.path)) {
      console.warn(`[skip] file not found: ${file.path}`);
      continue;
    }
    const html = fs.readFileSync(file.path, 'utf8');
    const section = file.section || extractSection(html) || CATEGORY_NAME;
    const list = parseProductsFromHtml(html, section);
    console.log(`Parsed ${list.length} from ${path.basename(file.path)} (${section})`);
    if (!list.length && fs.statSync(file.path).size < 50000) {
      console.warn(
        `[hint] ${path.basename(file.path)} may be incomplete — re-save page after products load (~100KB+)`
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

  const sourceFiles = parseCliFiles();
  const products = loadAllProducts(sourceFiles);
  if (!products.length) {
    console.error('No products found in HTML files.');
    console.error('Save Imtiaz Home Care subcategory pages as .htm in Downloads, then run again.');
    console.error('Expected default paths:', DEFAULT_SOURCE_FILES.map((f) => f.path).join('\n  '));
    process.exit(1);
  }

  console.log(`Total unique products: ${products.length}`);
  console.log(`Category slug: ${CATEGORY_SLUG}`);
  console.log(`Price markup: +${PRICE_MARKUP} Rs per product`);

  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  const cat = await Category.findOne({ slug: CATEGORY_SLUG });
  if (!cat) throw new Error(`Category "${CATEGORY_SLUG}" not found`);

  const subs = await ProductSubcategory.find({ category: cat._id, gender: '' }).lean();
  const subBySlug = new Map(subs.map((s) => [s.slug, s]));

  const removed = await Product.deleteMany({ category: cat._id });
  console.log(`Removed ${removed.deletedCount} existing home-care products.`);

  let created = 0;
  let fail = 0;

  for (let i = 0; i < products.length; i++) {
    const row = products[i];
    const brand = inferBrand(row.name);
    const productId = `${ID_PREFIX}_${row.sku.replace(/[^A-Za-z0-9]+/g, '_')}`;
    const shortDescription = row.description.slice(0, 500);
    const sub = row.subSlug ? subBySlug.get(row.subSlug) : null;

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
      shopSubcategory: sub?._id,
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
      `[${i + 1}/${products.length}] ${row.name} — Rs ${row.price}${row.subSlug ? ` [${row.subSlug}]` : ''}`
    );
  }

  const assignResult = await assignCategorySubcategories({
    categorySlug: CATEGORY_SLUG,
    publishedOnly: false
  });
  console.log('Subcategory assignment:', JSON.stringify(assignResult.counts));

  await syncCategoryVisibility(Category, Product);
  const total = await Product.countDocuments({ category: cat._id, isPublished: true });
  console.log('Done.', { created, fail, imported: products.length, categoryTotal: total });
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
