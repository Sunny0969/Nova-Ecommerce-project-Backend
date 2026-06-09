/**
 * Mirror production storefront catalog into local MongoDB (dev only).
 *
 * Usage (backend folder):
 *   npm run sync:production          # upsert categories, brands, products
 *   npm run sync:production -- --fresh   # clear local products/brands first
 *
 * Env:
 *   MONGODB_URI              — local target DB (from .env)
 *   SYNC_SOURCE_URL          — optional production API origin
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
const Category = require('../models/Category');
const Brand = require('../models/Brand');
const Product = require('../models/Product');
const { syncCategoryVisibility } = require('../lib/syncCategoryVisibility');

configureMongoDns();

const SOURCE =
  (process.env.SYNC_SOURCE_URL || 'https://nova-ecommerce-project-backend-production.up.railway.app')
    .replace(/\/$/, '')
    .replace(/\/api$/, '');

const FRESH = process.argv.includes('--fresh');
const PAGE_SIZE = 100;

async function fetchJson(path) {
  const url = `${SOURCE}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${path} → HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
  }
  const body = await res.json();
  if (body && body.success === false) {
    throw new Error(body.message || `Failed: ${path}`);
  }
  return body?.data;
}

async function fetchAllProducts() {
  const all = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const data = await fetchJson(`/api/products?page=${page}&limit=${PAGE_SIZE}`);
    const batch = Array.isArray(data?.products) ? data.products : [];
    all.push(...batch);
    totalPages = Math.max(1, Number(data?.totalPages) || 1);
    process.stdout.write(`\r[sync] products page ${page}/${totalPages} (${all.length} items)`);
    page += 1;
  }
  process.stdout.write('\n');
  return all;
}

async function upsertCategory(row) {
  if (!row?.slug) return null;
  const slug = String(row.slug).trim().toLowerCase();
  const payload = {
    name: String(row.name || slug).trim(),
    slug,
    description: String(row.description || '').slice(0, 2000),
    image: {
      url: row.image?.url || '',
      public_id: row.image?.public_id || ''
    },
    parent: row.parent || null,
    displayOrder: Number(row.displayOrder) || 0,
    isActive: row.isActive !== false
  };

  let doc = await Category.findOne({ slug }).lean();
  if (doc) {
    await Category.updateOne({ slug }, { $set: payload });
    return await Category.findOne({ slug }).select('_id slug').lean();
  }

  if (row._id && mongoose.Types.ObjectId.isValid(String(row._id))) {
    try {
      doc = await Category.create({ ...payload, _id: new mongoose.Types.ObjectId(String(row._id)) });
      return { _id: doc._id, slug: doc.slug };
    } catch (e) {
      if (e.code !== 11000) throw e;
    }
  }

  doc = await Category.create(payload);
  return { _id: doc._id, slug: doc.slug };
}

async function upsertBrand(row) {
  if (!row?.slug) return;
  const slug = String(row.slug).trim().toLowerCase();
  const payload = {
    name: String(row.name || slug).trim(),
    slug,
    image: {
      url: row.imageUrl || row.image?.url || '',
      public_id: row.image?.public_id || ''
    },
    isPopular: Boolean(row.isPopular),
    displayOrder: Number(row.displayOrder) || 0,
    isActive: true
  };

  const existing = await Brand.findOne({ slug }).select('_id').lean();
  if (existing) {
    await Brand.updateOne({ slug }, { $set: payload });
    return;
  }

  if (row._id && mongoose.Types.ObjectId.isValid(String(row._id))) {
    try {
      await Brand.create({ ...payload, _id: new mongoose.Types.ObjectId(String(row._id)) });
      return;
    } catch (e) {
      if (e.code !== 11000) throw e;
    }
  }

  await Brand.create(payload);
}

function toProductDoc(row, categoryId) {
  const stock = Number(row.stockQuantity ?? row.stock);
  return {
    name: String(row.name || '').trim().slice(0, 200),
    slug: String(row.slug || row.productId || '').trim().toLowerCase().slice(0, 200),
    productId: String(row.productId || row.slug || '').trim().slice(0, 200),
    description: String(row.description || ''),
    shortDescription: String(row.shortDescription || '').slice(0, 500),
    price: Number(row.price) || 0,
    comparePrice:
      row.comparePrice != null
        ? Number(row.comparePrice)
        : row.originalPrice != null
          ? Number(row.originalPrice)
          : null,
    images: Array.isArray(row.images) ? row.images : row.imageUrl ? [{ url: row.imageUrl, public_id: '' }] : [],
    category: categoryId,
    tags: Array.isArray(row.tags) ? row.tags : [],
    stock: Number.isFinite(stock) ? Math.max(0, Math.floor(stock)) : 0,
    ratings: Number(row.rating ?? row.ratings) || 0,
    numReviews: Number(row.ratingCount ?? row.numReviews) || 0,
    isFeatured: Boolean(row.isFeatured),
    isPublished: true,
    approvalStatus: 'approved',
    variantAxes: row.variantAxes || undefined,
    sku: row.sku || undefined,
    color: row.color || undefined,
    texture: row.texture || undefined,
    size: row.size || undefined,
    weight: row.weight || undefined,
    weightKg: row.weightKg != null ? Number(row.weightKg) : undefined
  };
}

async function upsertProduct(row, categoryBySlug) {
  const slug = String(row.slug || row.productId || '')
    .trim()
    .toLowerCase();
  if (!slug || !row.name) return false;

  const catSlug = String(row.category || 'fashion').trim().toLowerCase();
  const cat = categoryBySlug.get(catSlug);
  if (!cat?._id) {
    console.warn(`[sync] skip product ${slug} — unknown category "${catSlug}"`);
    return false;
  }

  const payload = toProductDoc(row, cat._id);
  const existing = await Product.findOne({ slug }).select('_id').lean();

  if (existing) {
    await Product.updateOne({ slug }, { $set: payload });
    return true;
  }

  if (row._id && mongoose.Types.ObjectId.isValid(String(row._id))) {
    try {
      await Product.create({ ...payload, _id: new mongoose.Types.ObjectId(String(row._id)) });
      return true;
    } catch (e) {
      if (e.code !== 11000) throw e;
    }
  }

  await Product.create(payload);
  return true;
}

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('[sync] MONGODB_URI is not set');
    process.exit(1);
  }

  console.log(`[sync] Source API: ${SOURCE}`);
  await mongoose.connect(uri, MONGOOSE_CONNECT_OPTS);
  console.log('[sync] Connected to local MongoDB');

  if (FRESH) {
    const [p, b] = await Promise.all([Product.deleteMany({}), Brand.deleteMany({})]);
    console.log(`[sync] --fresh cleared ${p.deletedCount} products, ${b.deletedCount} brands`);
  }

  console.log('[sync] Fetching categories…');
  const categories = await fetchJson('/api/categories');
  const categoryRows = Array.isArray(categories) ? categories : [];
  const categoryBySlug = new Map();

  for (const row of categoryRows) {
    const saved = await upsertCategory(row);
    if (saved?.slug) categoryBySlug.set(saved.slug, saved);
  }
  console.log(`[sync] ${categoryBySlug.size} storefront categories`);

  console.log('[sync] Fetching brands…');
  const brands = await fetchJson('/api/brands');
  const brandRows = Array.isArray(brands) ? brands : [];
  for (const row of brandRows) {
    await upsertBrand(row);
  }
  console.log(`[sync] ${brandRows.length} brands`);

  console.log('[sync] Fetching products…');
  const products = await fetchAllProducts();
  let savedProducts = 0;
  let skippedProducts = 0;
  for (const row of products) {
    try {
      if (await upsertProduct(row, categoryBySlug)) savedProducts += 1;
    } catch (err) {
      skippedProducts += 1;
      const slug = row?.slug || row?.productId || '?';
      console.warn(`[sync] skip product ${slug}: ${err.message}`);
    }
  }
  console.log(`[sync] ${savedProducts}/${products.length} products saved${skippedProducts ? ` (${skippedProducts} skipped)` : ''}`);

  const vis = await syncCategoryVisibility(Category, Product);
  console.log(`[sync] category visibility: ${vis.activated} active, ${vis.deactivated} hidden`);

  const counts = {
    categories: await Category.countDocuments({ isActive: true }),
    brands: await Brand.countDocuments({ isActive: true }),
    products: await Product.countDocuments({ isPublished: true })
  };
  console.log('[sync] Done.', counts);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error('[sync] Failed:', err.message);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
