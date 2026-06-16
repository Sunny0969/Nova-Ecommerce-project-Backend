/**
 * Seed / update Imrozia Serene Go Summer lawn 3-piece unstitched collection.
 *
 * Run:
 *   npm run seed:imrozia-serene-go-summer
 *   npm run seed:imrozia-serene-go-summer -- --force-images
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
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');

const PRODUCT_ID = 'imrozia-serene-go-summer-2026';
const IMAGE_DIR = path.join(__dirname, '..', 'seed-assets', 'imrozia-serene-go-summer');

const PRODUCT_NAME =
  'Imrozia | Serene Go Summer 💯 Outlet Stock Lawn 3 Pcs Unstitched Collection 2026!';

const SHORT_DESCRIPTION =
  'Premium lawn 3-piece unstitched suit with dupatta. Choose Green or Black. Outlet stock collection 2026.';

const DESCRIPTION_HTML = `
<h2>Imrozia | Serene Go Summer — Outlet Stock Lawn 3 Pcs Unstitched Collection 2026</h2>
<p>Premium quality <strong>unstitched 3-piece lawn suit</strong> from Imrozia Serene Go Summer. Available in <strong>Green</strong> and <strong>Black</strong>.</p>
<h3>👕 Shirt</h3>
<p>Shirt Unstitched: 2.51 Meters</p>
<h3>🎗️ Dupatta</h3>
<p>Dupatta: 2.51 Meters</p>
<h3>👖 Trouser</h3>
<p>Trouser Unstitched: 2.29 Meters</p>
<p>Soft lawn fabric with rich prints — perfect for summer wear, casual outings, and everyday elegance.</p>
`.trim();

/** Gallery order: black set, then green set */
const IMAGE_FILES = ['black-front.png', 'black-back.png', 'green-front.png', 'green-back.png'];

const COLOR_VARIANTS = [
  { label: 'Black', swatchFile: 'black-front.png' },
  { label: 'Green', swatchFile: 'green-front.png' }
];

function listLocalImages() {
  if (!fs.existsSync(IMAGE_DIR)) {
    throw new Error(`Image folder missing: ${IMAGE_DIR}`);
  }
  return IMAGE_FILES.map((f) => {
    const full = path.join(IMAGE_DIR, f);
    if (!fs.existsSync(full)) throw new Error(`Missing image: ${full}`);
    return full;
  });
}

async function uploadProductImages(force) {
  const existing = await Product.findOne({ productId: PRODUCT_ID }).lean();
  if (
    !force &&
    existing?.images?.length >= 4 &&
    existing.images.some((img) => String(img.public_id || '').includes('imrozia-serene-go-summer'))
  ) {
    console.log(`Using ${existing.images.length} existing Cloudinary images.`);
    return existing.images;
  }

  const files = listLocalImages();
  console.log(`Uploading ${files.length} images to Cloudinary…`);
  const images = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const uploaded = await uploadImageFile(file, {
      folder: 'nova-shop/products/imrozia-serene-go-summer'
    });
    images.push(uploaded);
    console.log(`  [${i + 1}/${files.length}] ${path.basename(file)}`);
  }
  return images;
}

function imageByBasename(images, basename) {
  const idx = IMAGE_FILES.indexOf(basename);
  if (idx < 0 || !images[idx]) return { url: '', public_id: '' };
  return { url: images[idx].url, public_id: images[idx].public_id || '' };
}

function buildVariantAxes(images) {
  const colorOptions = COLOR_VARIANTS.map(({ label, swatchFile }) => ({
    label,
    image: imageByBasename(images, swatchFile)
  }));

  return {
    color: {
      enabled: true,
      selectionMode: 'single',
      options: colorOptions
    },
    shape: { enabled: false, selectionMode: 'single', options: [] },
    size: { enabled: false, selectionMode: 'single', options: [] }
  };
}

async function upsertProduct({ forceImages = false } = {}) {
  await ensureHomeCategories(Category);
  const clothing = await Category.findOne({ slug: 'clothing', isActive: true });
  if (!clothing) {
    throw new Error('Clothing category not found.');
  }

  const images = await uploadProductImages(forceImages);
  const variantAxes = buildVariantAxes(images);

  const payload = {
    name: PRODUCT_NAME,
    shortDescription: SHORT_DESCRIPTION,
    description: DESCRIPTION_HTML,
    price: 9600,
    comparePrice: 11000,
    costPrice: null,
    images,
    category: clothing._id,
    tags: ['clothing', 'lawn', '3-piece', 'unstitched', 'imrozia', 'serene-go', 'outlet', 'summer'],
    color: 'Green, Black',
    size: '',
    weight: 'Lightweight lawn suit',
    weightKg: 0.4,
    variantGroupKey: 'imrozia-serene-go-summer-2026',
    variantAxes,
    stock: 50,
    lowStockThreshold: 5,
    sku: 'IMROZIA-SGS-2026',
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
    console.log('');
    console.log('Done.');
    console.log('  Name:', product.name);
    console.log('  Slug:', product.slug);
    console.log('  Price:', product.price);
    console.log('  Compare:', product.comparePrice);
    console.log('  Colors:', product.color);
    console.log('  Images:', product.images?.length || 0);
    console.log('  Store URL: /clothing/' + product.slug);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('seed:imrozia-serene-go-summer failed:', err.message);
  process.exit(1);
});
