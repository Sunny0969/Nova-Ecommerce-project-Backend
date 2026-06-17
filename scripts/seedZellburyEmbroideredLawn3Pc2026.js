/**
 * Seed / update Zellbury Embroidered Lawn 3 Pcs Unstitched (women, single product, gallery images).
 *
 * Run:
 *   npm run seed:zellbury-embroidered-lawn-3pc-2026
 *   npm run seed:zellbury-embroidered-lawn-3pc-2026 -- --force-images
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

const PRODUCT_ID = 'zellbury-embroidered-lawn-3pc-2026';
const IMAGE_DIR = path.join(__dirname, '..', 'seed-assets', 'zellbury-embroidered-lawn-3pc-2026');
const PRICE = 5444;
const COMPARE_PRICE = 6299;

const PRODUCT_NAME =
  'Zellbury Embroided 💯 Outlet Stock Lawn 3 Pcs Unstitched Collection 2026!';

const COLOR = 'Mustard Magenta Gradient';

const SHORT_DESCRIPTION =
  'Embroidered lawn 3-piece unstitched suit — digital printed shirt, doria dupatta & cambric trouser. Loose available.';

const DESCRIPTION_HTML = `
<h2>Zellbury Embroided — Outlet Stock Lawn 3 Pcs Unstitched Collection 2026</h2>
<p>Premium <strong>${COLOR}</strong> embroidered lawn from Zellbury outlet stock. Soft summer fabric with rich digital print, neckline embroidery, and coordinated borders.</p>
<h3>👕 Shirt</h3>
<p>Digital Printed Embroidered Lawn Shirt</p>
<h3>🎗️ Dupatta</h3>
<p>Digital Printed Doria Dupatta</p>
<h3>👖 Trouser</h3>
<p>Dyed Cambric Trouser</p>
<ul>
  <li><strong>Loose</strong> available</li>
</ul>
<p>Unstitched 3-piece set — perfect for casual wear, festive summer dressing, and everyday elegance.</p>
`.trim();

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
    existing?.images?.length >= 3 &&
    existing.images.some((img) => String(img.public_id || '').includes('zellbury-embroidered-lawn'))
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
      folder: 'nova-shop/products/zellbury-embroidered-lawn-3pc-2026',
      public_id: `${PRODUCT_ID}-${String(i + 1).padStart(2, '0')}`
    });
    images.push(uploaded);
    console.log(`  [${i + 1}/${files.length}] ${path.basename(file)}`);
  }
  return images;
}

async function resolveWomen3PieceSubcategory(categoryId) {
  const row = await ProductSubcategory.findOne({
    category: categoryId,
    gender: 'women',
    slug: '3-piece',
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

  const subcategoryId = await resolveWomen3PieceSubcategory(clothing._id);
  if (!subcategoryId) {
    console.warn('[warn] Women 3-piece subcategory not found — run npm run categories:clothing-filters');
  }

  const images = await uploadProductImages(forceImages);

  const payload = {
    name: PRODUCT_NAME,
    shortDescription: SHORT_DESCRIPTION,
    description: DESCRIPTION_HTML,
    price: PRICE,
    comparePrice: COMPARE_PRICE,
    costPrice: null,
    images,
    category: clothing._id,
    shopGender: 'women',
    shopSubcategory: subcategoryId,
    tags: [
      'zellbury',
      'lawn',
      '3-piece',
      'unstitched',
      'women',
      'embroidered',
      'outlet',
      '2026',
      'loose'
    ],
    color: COLOR,
    size: 'Loose available',
    weight: 'Unstitched lawn 3-piece suit',
    weightKg: 0.55,
    variantAxes: {
      color: { enabled: false, selectionMode: 'single', options: [] },
      shape: { enabled: false, selectionMode: 'single', options: [] },
      size: { enabled: false, selectionMode: 'single', options: [] }
    },
    stock: 40,
    lowStockThreshold: 5,
    sku: 'ZELLBURY-EMB-LAWN-3PC-2026',
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
    console.log('  Images:', product.images?.length || 0);
    console.log('  Filter: Clothing → Women → 3 Piece');
    console.log('  Store URL: /clothing/' + product.slug);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('seed:zellbury-embroidered-lawn-3pc-2026 failed:', err.message);
  process.exit(1);
});
