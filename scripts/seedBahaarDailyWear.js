/**
 * Seed / update Bahaar Daily Wear lawn 3-piece collection in Clothing category.
 *
 * Run:
 *   npm run seed:bahaar-daily-wear
 *   npm run seed:bahaar-daily-wear -- --force-images   (re-upload Cloudinary images)
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { ensureHomeCategories } = require('../lib/homeCategoriesSeed');
const { uploadImageFile } = require('../lib/cloudinary');

const PRODUCT_ID = 'bahaar-daily-wear-2026';
const IMAGE_DIR = path.join(__dirname, '..', 'seed-assets', 'bahaar-daily-wear');

const PRODUCT_NAME =
  'Bahaar Daily Wear 💯 Outlet Stock Lawn 3 Pcs Stitched Collection 2026!';

const SHORT_DESCRIPTION =
  'Digital printed lawn 3-piece stitched suit — shirt, dupatta & cambric trouser. Sizes S–XL. Outlet stock.';

const DESCRIPTION_HTML = `
<h2>Bahaar Daily Wear — Outlet Stock Lawn 3 Pcs Stitched Collection 2026</h2>
<p>Premium quality <strong>stitched 3-piece lawn suit</strong> for daily wear. Multiple designs available — see product gallery.</p>
<h3>👕 Shirt</h3>
<p>Digital Printed Straight Cut Lawn Kurta</p>
<h3>🎗️ Dupatta</h3>
<p>Digital Printed Lawn Dupatta</p>
<h3>👖 Trouser</h3>
<p>Dyed Cambric Straight Trouser</p>
<ul>
  <li><strong>Retail:</strong> Rs. 5,590</li>
  <li><strong>Loose</strong> available</li>
  <li><strong>4 Piece Set</strong> available</li>
  <li><strong>Sizes:</strong> S, M, L, XL</li>
</ul>
<p>Perfect for casual outings, office wear, and everyday elegance. Soft lawn fabric with vibrant digital prints.</p>
`.trim();

const COLOR_LABELS = [
  'Dusty Blue Floral',
  'Yellow Floral',
  'Navy Pink Floral',
  'Mint Green Border',
  'Navy Lattice Pink',
  'Black Floral Dupatta',
  'Sage Green Chevron',
  'Rose Pink Gold',
  'Blue White Floral',
  'Lilac Purple',
  'Purple Mustard Border',
  'Black Orange Dupatta',
  'Black Red Floral',
  'Emerald Green',
  'Black White Geometric'
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
    existing?.images?.length >= 5 &&
    existing.images.some((img) => String(img.public_id || '').includes('bahaar-daily-wear'))
  ) {
    console.log(`Using ${existing.images.length} existing Cloudinary images.`);
    return existing.images;
  }

  const files = listLocalImages();
  if (!files.length) {
    throw new Error(`No images found in ${IMAGE_DIR}`);
  }

  console.log(`Uploading ${files.length} images to Cloudinary…`);
  const images = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const uploaded = await uploadImageFile(file, {
      folder: 'nova-shop/products/bahaar-daily-wear'
    });
    images.push(uploaded);
    console.log(`  [${i + 1}/${files.length}] ${path.basename(file)}`);
  }
  return images;
}

function buildVariantAxes(images) {
  const colorOptions = images.slice(0, COLOR_LABELS.length).map((img, idx) => ({
    label: COLOR_LABELS[idx] || `Design ${idx + 1}`,
    image: { url: img.url, public_id: img.public_id || '' }
  }));

  return {
    color: {
      enabled: colorOptions.length > 0,
      selectionMode: 'single',
      options: colorOptions
    },
    shape: { enabled: false, selectionMode: 'single', options: [] },
    size: {
      enabled: true,
      selectionMode: 'single',
      options: ['S', 'M', 'L', 'XL'].map((label) => ({
        label,
        image: { url: '', public_id: '' }
      }))
    }
  };
}

async function upsertBahaarDailyWear({ forceImages = false } = {}) {
  await ensureHomeCategories(Category);
  const clothing = await Category.findOne({ slug: 'clothing', isActive: true });
  if (!clothing) {
    throw new Error('Clothing category not found. Run npm run seed:categories first.');
  }

  const images = await uploadProductImages(forceImages);
  const variantAxes = buildVariantAxes(images);

  const payload = {
    name: PRODUCT_NAME,
    shortDescription: SHORT_DESCRIPTION,
    description: DESCRIPTION_HTML,
    price: 5590,
    comparePrice: null,
    costPrice: null,
    images,
    category: clothing._id,
    tags: [
      'clothing',
      'lawn',
      '3-piece',
      'stitched',
      'bahaar',
      'daily-wear',
      'outlet',
      'loose',
      '4-piece-set'
    ],
    color: COLOR_LABELS.join(', ').slice(0, 120),
    size: 'S, M, L, XL',
    weight: 'Lightweight lawn suit',
    weightKg: 0.45,
    variantGroupKey: 'bahaar-daily-wear-2026',
    variantAxes,
    stock: 120,
    lowStockThreshold: 10,
    sku: 'BAHAAR-DW-2026',
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
    const product = await upsertBahaarDailyWear({ forceImages });
    console.log('');
    console.log('Done.');
    console.log('  Name:', product.name);
    console.log('  Slug:', product.slug);
    console.log('  Price: Rs.', product.price);
    console.log('  Images:', product.images?.length || 0);
    console.log('  Admin edit: /admin/products/' + product._id);
    console.log('  Store URL: /product/' + product.slug);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('seed:bahaar-daily-wear failed:', err.message);
  process.exit(1);
});
