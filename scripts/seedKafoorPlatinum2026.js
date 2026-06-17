/**
 * Seed / update Kafoor Fabrics Platinum men's wash & wear unstitched (one product, color variants).
 *
 * Run:
 *   npm run seed:kafoor-platinum-2026
 *   npm run seed:kafoor-platinum-2026 -- --force-images
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const ProductSubcategory = require('../models/ProductSubcategory');
const { ensureHomeCategories } = require('../lib/homeCategoriesSeed');
const { uploadImageFile } = require('../lib/cloudinary');
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');
const { regenerateSitemapAutopilot } = require('../lib/regenerateSitemapAutopilot');

const PRODUCT_ID = 'kafoor-platinum-wash-wear-2026';
const IMAGE_DIR = path.join(__dirname, '..', 'seed-assets', 'kafoor-platinum-2026');
const PRICE = 4812;
const COMPARE_PRICE = 5499;

const PRODUCT_NAME =
  'Kafoor Fabrics Platinium 💯 Outlet Stock Wash & Wear Unstitched Collection 2026!';

const SHORT_DESCRIPTION =
  'Premium Kafoor Platinum wash & wear unstitched fabric for men. Choose from 12 colours — all-season daily wear.';

const DESCRIPTION_HTML = `
<h2>Kafoor Fabrics Platinium — Outlet Stock Wash & Wear Unstitched Collection 2026</h2>
<p>This versatile daily wear bottom from Kafoor Fabrics is a must-have for any man's wardrobe. Crafted from high-quality wash & wear fabric, this unstitched piece is perfect for all seasons.</p>
<p>Its simple design and comfortable fabric make it ideal for everyday wear. Elevate your eastern attire effortlessly with this essential piece.</p>
<p><strong>Platinum by Kafoor Fabrics</strong> — authentic outlet stock wash & wear. Select your preferred colour above.</p>
`.trim();

/** Gallery order 01.png–12.png (sorted by source timestamp). */
const COLOR_LABELS = [
  'Warm Beige',
  'Sage Green',
  'Navy Blue',
  'Pure White',
  'Terracotta Rust',
  'Cream Ivory',
  'Sand Beige',
  'Classic Cream',
  'Sky Blue',
  'Dusty Rose',
  'Platinum Grey',
  'Powder Blue'
];

function listLocalImages() {
  if (!fs.existsSync(IMAGE_DIR)) {
    throw new Error(`Image folder missing: ${IMAGE_DIR}`);
  }
  return fs
    .readdirSync(IMAGE_DIR)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .sort()
    .map((f) => path.join(IMAGE_DIR, f));
}

async function uploadProductImages(force) {
  const existing = await Product.findOne({ productId: PRODUCT_ID }).lean();
  if (
    !force &&
    existing?.images?.length >= COLOR_LABELS.length &&
    existing.images.some((img) => String(img.public_id || '').includes('kafoor-platinum'))
  ) {
    console.log(`Using ${existing.images.length} existing Cloudinary images.`);
    return existing.images;
  }

  const files = listLocalImages();
  if (files.length < COLOR_LABELS.length) {
    throw new Error(`Expected ${COLOR_LABELS.length} images, found ${files.length} in ${IMAGE_DIR}`);
  }

  console.log(`Uploading ${files.length} images to Cloudinary…`);
  const images = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const uploaded = await uploadImageFile(file, {
      folder: 'nova-shop/products/kafoor-platinum-2026',
      public_id: `${PRODUCT_ID}-${String(i + 1).padStart(2, '0')}`
    });
    images.push(uploaded);
    console.log(`  [${i + 1}/${files.length}] ${path.basename(file)}`);
  }
  return images;
}

function buildVariantAxes(images) {
  const colorOptions = images.slice(0, COLOR_LABELS.length).map((img, idx) => ({
    label: COLOR_LABELS[idx],
    image: { url: img.url, public_id: img.public_id || '' }
  }));

  return {
    color: {
      enabled: colorOptions.length > 0,
      selectionMode: 'single',
      options: colorOptions
    },
    shape: { enabled: false, selectionMode: 'single', options: [] },
    size: { enabled: false, selectionMode: 'single', options: [] }
  };
}

async function resolveMenUnstitchedSubcategory(categoryId) {
  const row = await ProductSubcategory.findOne({
    category: categoryId,
    gender: 'men',
    slug: 'unstitched',
    isActive: true
  })
    .select('_id')
    .lean();
  return row?._id || null;
}

async function upsertProduct({ forceImages = false } = {}) {
  await ensureHomeCategories(Category);
  const clothing = await Category.findOne({ slug: 'clothing', isActive: true });
  if (!clothing) {
    throw new Error('Clothing category not found. Run npm run seed:categories first.');
  }

  const subcategoryId = await resolveMenUnstitchedSubcategory(clothing._id);
  if (!subcategoryId) {
    console.warn('[warn] Men unstitched subcategory not found — run npm run categories:clothing-filters');
  }

  const images = await uploadProductImages(forceImages);
  const variantAxes = buildVariantAxes(images);

  const payload = {
    name: PRODUCT_NAME,
    shortDescription: SHORT_DESCRIPTION,
    description: DESCRIPTION_HTML,
    price: PRICE,
    comparePrice: COMPARE_PRICE,
    costPrice: null,
    images,
    category: clothing._id,
    shopGender: 'men',
    shopSubcategory: subcategoryId,
    tags: [
      'clothing',
      'kafoor',
      'kafoor-fabrics',
      'platinum',
      'wash-and-wear',
      'unstitched',
      'men',
      'outlet',
      '2026'
    ],
    color: COLOR_LABELS.join(', ').slice(0, 120),
    size: '',
    weight: 'Unstitched wash & wear fabric',
    weightKg: 0.4,
    variantGroupKey: PRODUCT_ID,
    variantAxes,
    stock: 120,
    lowStockThreshold: 10,
    sku: 'KAFOOR-PLATINUM-2026',
    isFeatured: true,
    isPublished: true,
    approvalStatus: 'approved'
  };

  let product = await Product.findOne({ productId: PRODUCT_ID });
  if (product) {
    Object.assign(product, payload);
    await product.save();
    console.log('Updated product:', product.slug);
  } else {
    product = await Product.create({ productId: PRODUCT_ID, ...payload });
    console.log('Created product:', product.slug);
  }

  invalidateCatalogCache();
  return product;
}

async function main() {
  const forceImages = process.argv.includes('--force-images');

  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI missing in backend/.env');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  try {
    const product = await upsertProduct({ forceImages });
    const sitemap = await regenerateSitemapAutopilot();
    if (sitemap.ok) console.log(`[sitemap] ${sitemap.urlCount} URLs`);

    console.log('');
    console.log('Done.');
    console.log('  Name:', product.name);
    console.log('  Slug:', product.slug);
    console.log('  Price: Rs', product.price);
    console.log('  Compare: Rs', product.comparePrice);
    console.log('  Colors:', COLOR_LABELS.length);
    console.log('  Filter: Clothing → Men → Unstitched');
    console.log('  Store URL: /clothing/' + product.slug);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('seed:kafoor-platinum-2026 failed:', err.message);
  process.exit(1);
});
