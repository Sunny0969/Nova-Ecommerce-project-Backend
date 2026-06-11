/**
 * Seed Imported Perfume category + products from Google Sheet export.
 *
 * Sheet export: backend/seed-assets/imported-perfumes/sheet-export.md
 * Pricing: (sheet USD + $15 markup) × USD_TO_PKR_RATE
 *
 * Run:
 *   npm run seed:imported-perfumes
 *   npm run seed:imported-perfumes -- --limit=5
 *   npm run seed:imported-perfumes -- --force-images
 *   npm run seed:imported-perfumes -- --dry-run
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Category = require('../models/Category');
const Brand = require('../models/Brand');
const Product = require('../models/Product');
const { ensureConfigured, uploadImageBuffer } = require('../lib/cloudinary');
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');
const {
  parsePerfumeSheetExport,
  buildDescription,
  buildShortDescription,
  slugify,
  DEFAULT_SHEET
} = require('./parsePerfumeSheet');

const CATEGORY_SLUG = 'imported-perfume';
const CATEGORY_NAME = 'Imported Perfume';
const CATEGORY_IMAGE_URL =
  'https://images.unsplash.com/photo-1635796332668-78830169097d?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8Nnx8aW1wb3J0ZWQlMjBwZXJmdW1lfGVufDB8MHwwfHx8Mg%3D%3D';
const ID_PREFIX = 'imported-perfume';
const MARKUP_USD = Number(process.env.PERFUME_MARKUP_USD) || 15;
const USD_TO_PKR = Number(process.env.USD_TO_PKR_RATE) || 280;

function argFlag(name) {
  return process.argv.includes(name);
}

function argValue(prefix) {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (!hit) return null;
  return hit.split('=').slice(1).join('=') || null;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function downloadImage(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'image/*',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new Error('Empty image');
    return buf;
  } finally {
    clearTimeout(t);
  }
}

async function uploadProductImage(imageUrl, productKey, force) {
  const existing = await Product.findOne({ productId: productKey }).select('images').lean();
  if (
    !force &&
    existing?.images?.length &&
    existing.images.some((img) => String(img.public_id || '').includes('imported-perfume'))
  ) {
    return existing.images;
  }

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const buf = await downloadImage(imageUrl);
      const uploaded = await uploadImageBuffer(buf, {
        folder: `nova-shop/products/${CATEGORY_SLUG}`,
        public_id: productKey.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80)
      });
      return [uploaded];
    } catch (e) {
      lastErr = e;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr || new Error('Image upload failed');
}

async function ensureCategory() {
  let cat = await Category.findOne({ slug: CATEGORY_SLUG });
  if (cat) {
    await Category.updateOne(
      { _id: cat._id },
      {
        $set: {
          name: CATEGORY_NAME,
          description: 'Authentic imported designer perfumes — original fragrances with fast delivery.',
          isActive: true,
          displayOrder: 18,
          image: {
            url: CATEGORY_IMAGE_URL,
            public_id: ''
          }
        }
      }
    );
    return Category.findById(cat._id);
  }

  cat = await Category.create({
    name: CATEGORY_NAME,
    slug: CATEGORY_SLUG,
    description: 'Authentic imported designer perfumes — original fragrances with fast delivery.',
    isActive: true,
    displayOrder: 18,
    image: {
      url: CATEGORY_IMAGE_URL,
      public_id: ''
    }
  });
  return cat;
}

async function ensureBrand(brandName, sampleImageUrl, forceImages) {
  const slug = slugify(brandName) || 'imported-perfume';
  let brand = await Brand.findOne({ slug });
  if (brand && brand.image?.url && !forceImages) return brand;

  let image = brand?.image || { url: '', public_id: '' };
  if ((!image.url || forceImages) && sampleImageUrl && ensureConfigured()) {
    try {
      const buf = await downloadImage(sampleImageUrl);
      image = await uploadImageBuffer(buf, {
        folder: `nova-shop/brands/${slug}`,
        public_id: slug
      });
    } catch {
      /* brand logo optional */
    }
  }

  if (brand) {
    await Brand.updateOne(
      { _id: brand._id },
      {
        $set: {
          name: brandName,
          isActive: true,
          isPopular: true,
          ...(image.url ? { image } : {})
        }
      }
    );
    return Brand.findById(brand._id);
  }

  return Brand.create({
    name: brandName,
    slug,
    image,
    isActive: true,
    isPopular: true,
    displayOrder: 50
  });
}

function retailPricePkr(sheetUsd) {
  const retailUsd = sheetUsd + MARKUP_USD;
  return {
    retailUsd,
    pricePkr: Math.round(retailUsd * USD_TO_PKR),
    comparePkr: Math.round((retailUsd * 1.12) * USD_TO_PKR)
  };
}

async function upsertProduct(item, categoryId, forceImages, dryRun) {
  const productKey = item.sku
    ? `${ID_PREFIX}_${item.sku.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()}`
    : `${ID_PREFIX}_row_${item.rowNum}`;

  const { retailUsd, pricePkr, comparePkr } = retailPricePkr(item.sheetUsd);
  const shortDescription = buildShortDescription({
    name: item.name,
    brand: item.brand
  });
  const description = buildDescription({
    name: item.name,
    brand: item.brand,
    quantityLabel: item.quantityLabel,
    status: item.status,
    warehouse: item.warehouse,
    sku: item.sku,
    sheetUsd: item.sheetUsd,
    retailUsd,
    retailPkr: pricePkr
  });

  if (dryRun) {
    console.log(`[dry-run] ${item.name.slice(0, 60)} | Rs.${pricePkr} | ${item.brand}`);
    return { created: false, updated: false, dryRun: true };
  }

  let images = [];
  if (ensureConfigured()) {
    images = await uploadProductImage(item.imageUrl, productKey, forceImages);
  } else {
    images = [{ url: item.imageUrl, public_id: '' }];
  }

  const payload = {
    name: item.name,
    productId: productKey,
    category: categoryId,
    description,
    shortDescription: shortDescription.slice(0, 500),
    price: pricePkr,
    comparePrice: comparePkr > pricePkr ? comparePkr : null,
    stock: item.stock,
    sku: item.sku || undefined,
    tags: item.tags,
    images,
    isPublished: item.stock > 0,
    isFeatured: false,
    approvalStatus: 'approved'
  };

  const existing = await Product.findOne({ productId: productKey });
  if (existing) {
    await Product.updateOne({ _id: existing._id }, { $set: payload });
    return { created: false, updated: true, id: existing._id };
  }

  const doc = await Product.create(payload);
  return { created: true, updated: false, id: doc._id };
}

async function main() {
  const dryRun = argFlag('--dry-run');
  const forceImages = argFlag('--force-images');
  const limitArg = argValue('--limit=');
  const limit = limitArg ? Math.max(1, parseInt(limitArg, 10)) : null;

  let items = parsePerfumeSheetExport(DEFAULT_SHEET);
  if (!items.length) {
    console.error('No products parsed from sheet. Check seed-assets/imported-perfumes/sheet-export.md');
    process.exit(1);
  }
  if (limit) items = items.slice(0, limit);

  console.log(`Parsed ${items.length} perfumes from sheet`);
  console.log(`Pricing: (sheet USD + $${MARKUP_USD}) × ${USD_TO_PKR} PKR`);

  if (dryRun) {
    for (const item of items) {
      await upsertProduct(item, null, false, true);
    }
    return;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI missing in backend/.env');
    process.exit(1);
  }

  await mongoose.connect(uri, MONGOOSE_CONNECT_OPTS);
  console.log('Connected to MongoDB');

  try {
    const category = await ensureCategory();
    console.log(`Category: ${category.name} (${category.slug})`);

    const brandSamples = new Map();
    for (const item of items) {
      if (!brandSamples.has(item.brand)) brandSamples.set(item.brand, item.imageUrl);
    }
    for (const [brandName, img] of brandSamples) {
      await ensureBrand(brandName, img, forceImages);
    }
    console.log(`Brands upserted: ${brandSamples.size}`);

    let created = 0;
    let updated = 0;
    let failed = 0;

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      try {
        const result = await upsertProduct(item, category._id, forceImages, false);
        if (result.created) created += 1;
        if (result.updated) updated += 1;
        console.log(
          `[${i + 1}/${items.length}] ${result.created ? 'CREATED' : 'UPDATED'}: ${item.name.slice(0, 55)}…`
        );
      } catch (e) {
        failed += 1;
        console.error(`[FAIL] row ${item.rowNum} ${item.name.slice(0, 40)}: ${e.message}`);
      }
      await sleep(300);
    }

    invalidateCatalogCache();

    console.log('\n--- Done ---');
    console.log(`Created: ${created} | Updated: ${updated} | Failed: ${failed}`);
    console.log(`Shop: /${CATEGORY_SLUG}`);
    console.log('Admin: /admin/products (search "imported-perfume")');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('seed:imported-perfumes failed:', err.message);
  process.exit(1);
});
