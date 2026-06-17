/**
 * Seed 41 Zellbury Printed Lawn 2 Pcs Unstitched products (women, 2-piece).
 *
 * Run:
 *   npm run seed:zellbury-lawn-2pc-2026
 *   npm run seed:zellbury-lawn-2pc-2026 -- --force-images
 *   npm run seed:zellbury-lawn-2pc-2026 -- --limit=5
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
const { uploadImageFile } = require('../lib/cloudinary');
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');
const { regenerateSitemapAutopilot } = require('../lib/regenerateSitemapAutopilot');

const IMAGE_DIR = path.join(__dirname, '..', 'seed-assets', 'zellbury-lawn-2pc-2026');
const PRICE = 3456;
const COMPARE_PRICE = 3999;
const ID_PREFIX = 'zellbury-lawn-2pc-2026';

/** Unique colour / style label per product (41 separate listings). */
const COLOR_NAMES = [
  'Soft Peach',
  'Emerald Green',
  'Rust Orange',
  'Maroon Red',
  'Golden Yellow',
  'Teal Blue',
  'Pastel Pink',
  'Mocha Brown',
  'Ivory Cream',
  'Charcoal Black',
  'Sky Blue',
  'Lemon Lime',
  'Rose Blush',
  'Turquoise Aqua',
  'Sand Beige',
  'Wine Burgundy',
  'Forest Olive',
  'Lilac Purple',
  'Coral Salmon',
  'Cherry Red',
  'Mint Fresh Green',
  'Denim Navy',
  'Black & Orange Paisley',
  'Beige & Orange Floral',
  'Dusty Rose',
  'Mauve Lilac',
  'Slate Grey Blue',
  'Mint Green Floral',
  'Purple Ikat Print',
  'Beige & Red Ethnic',
  'Lavender & Cream',
  'Black Floral Print',
  'Lilac & Beige Bloom',
  'Red & Off-White Floral',
  'Navy Blue Geometric',
  'Sky Blue Striped Floral',
  'Lilac Gradient Floral',
  'Azure Lace Trim',
  'Fuchsia Pink Floral',
  'Black & White Floral',
  'Black & Orange Geo'
];

function argValue(prefix) {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (!hit) return null;
  return hit.split('=').slice(1).join('=') || null;
}

function buildShortDescription(color, idx) {
  const lines = [
    `${color} digital printed lawn 2-piece unstitched — shirt plus dupatta/trouser fabric.`,
    `Zellbury outlet stock lawn in ${color}: printed shirt and matching dupatta/trouser.`,
    `Women's unstitched 2-piece lawn set in ${color} with vibrant digital print.`,
    `${color} lawn 2-piece — premium digital printed shirt and coordinating dupatta/trouser.`,
    `Summer lawn 2-piece unstitched suit in ${color} from Zellbury 2026 outlet collection.`
  ];
  return lines[idx % lines.length];
}

function buildDescription(color, idx) {
  const intros = [
    `Elegant ${color} tones from the Zellbury outlet stock lawn range.`,
    `Fresh ${color} digital prints for everyday summer style.`,
    `A standout ${color} 2-piece from the 2026 Zellbury collection.`,
    `Soft lawn fabric in beautiful ${color} — stitch it your way.`,
    `Vibrant ${color} palette with crisp digital print quality throughout.`
  ];
  const intro = intros[idx % intros.length];
  const shirtLines = [
    'Digital printed lawn shirt with rich colour and fine print detail.',
    'Premium digital printed lawn shirt — lightweight, breathable summer lawn.',
    'Digital printed lawn shirt featuring sharp motifs and a smooth finish.',
    'High-quality digital printed lawn shirt, ideal for custom tailoring.'
  ];
  const dupattaLines = [
    'Digital printed lawn dupatta / trouser fabric for a coordinated 2-piece look.',
    'Matching digital printed lawn dupatta / trouser to pair with the shirt.',
    'Digital printed lawn dupatta / trouser piece with complementary print.',
    'Coordinating digital printed lawn dupatta / trouser fabric included.'
  ];
  return `
<h2>Zellbury Printed Lawn 2 Pcs Unstitched — ${color}</h2>
<p><strong>Zellbury Printed 💯 Outlet Stock Lawn 2 Pcs Unstitched Collection 2026!</strong></p>
<p>${intro}</p>
<h3>👕 Shirt</h3>
<p>${shirtLines[idx % shirtLines.length]}</p>
<h3>🎗️👖 Dupatta / Trouser</h3>
<p>${dupattaLines[idx % dupattaLines.length]}</p>
<p>Unstitched 2-piece set — perfect for casual wear, outings, and festive summer dressing.</p>
`.trim();
}

function buildProducts() {
  return COLOR_NAMES.map((color, i) => {
    const num = String(i + 1).padStart(2, '0');
    const slugKey = color
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return {
      productId: `${ID_PREFIX}-${num}`,
      imageFile: `${num}.png`,
      name: `Zellbury Printed 💯 Outlet Stock Lawn 2 Pcs Unstitched — ${color} | Collection 2026`,
      color,
      shortDescription: buildShortDescription(color, i),
      description: buildDescription(color, i),
      tags: [
        'zellbury',
        'lawn',
        '2-piece',
        'unstitched',
        'women',
        'outlet',
        '2026',
        'digital print',
        slugKey
      ]
    };
  });
}

function imagePath(filename) {
  const full = path.join(IMAGE_DIR, filename);
  if (!fs.existsSync(full)) throw new Error(`Missing image: ${full}`);
  return full;
}

async function resolveWomen2PieceSubcategory(categoryId) {
  const row = await ProductSubcategory.findOne({
    category: categoryId,
    gender: 'women',
    slug: '2-piece',
    isActive: true
  })
    .select('_id')
    .lean();
  return row?._id || null;
}

async function uploadProductImage(spec, force) {
  const existing = await Product.findOne({ productId: spec.productId }).select('images').lean();
  if (
    !force &&
    existing?.images?.length &&
    existing.images.some((img) => String(img.public_id || '').includes(ID_PREFIX))
  ) {
    return existing.images;
  }

  const file = imagePath(spec.imageFile);
  const uploaded = await uploadImageFile(file, {
    folder: `nova-shop/products/${ID_PREFIX}`,
    public_id: spec.productId
  });
  return [uploaded];
}

async function upsertProduct(spec, categoryId, subcategoryId, forceImages) {
  const images = await uploadProductImage(spec, forceImages);

  const payload = {
    name: spec.name,
    shortDescription: spec.shortDescription,
    description: spec.description,
    price: PRICE,
    comparePrice: COMPARE_PRICE,
    costPrice: null,
    images,
    category: categoryId,
    shopGender: 'women',
    shopSubcategory: subcategoryId,
    tags: spec.tags,
    color: spec.color,
    size: '',
    weight: 'Unstitched lawn 2-piece suit',
    weightKg: 0.45,
    variantAxes: {
      color: { enabled: false, selectionMode: 'single', options: [] },
      shape: { enabled: false, selectionMode: 'single', options: [] },
      size: { enabled: false, selectionMode: 'single', options: [] }
    },
    stock: 30,
    lowStockThreshold: 5,
    sku: spec.productId.toUpperCase().replace(/-/g, '_'),
    isFeatured: false,
    isPublished: true,
    approvalStatus: 'approved'
  };

  let product = await Product.findOne({ productId: spec.productId });
  if (product) {
    Object.assign(product, payload);
    await product.save();
    return { product, action: 'updated' };
  }
  product = await Product.create({ productId: spec.productId, ...payload });
  return { product, action: 'created' };
}

async function main() {
  const forceImages = process.argv.includes('--force-images');
  const limitRaw = argValue('--limit=');
  const limit = limitRaw ? Math.max(1, parseInt(limitRaw, 10) || 0) : null;

  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI missing in backend/.env');
    process.exit(1);
  }

  const allProducts = buildProducts();
  const products = limit ? allProducts.slice(0, limit) : allProducts;

  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  try {
    const clothing = await Category.findOne({ slug: 'clothing', isActive: true });
    if (!clothing) throw new Error('Clothing category not found');

    const subcategoryId = await resolveWomen2PieceSubcategory(clothing._id);
    if (!subcategoryId) {
      console.warn('[warn] Women 2-piece subcategory not found — run npm run categories:clothing-filters');
    }

    console.log(`Seeding ${products.length} Zellbury lawn 2-piece products…\n`);

    let created = 0;
    let updated = 0;
    for (const spec of products) {
      const { product, action } = await upsertProduct(
        spec,
        clothing._id,
        subcategoryId,
        forceImages
      );
      if (action === 'created') created += 1;
      else updated += 1;
      console.log(`${action}: ${spec.color}`);
      console.log(`  /clothing/${product.slug}`);
    }

    invalidateCatalogCache();
    const sitemap = await regenerateSitemapAutopilot();
    if (sitemap.ok) console.log(`\n[sitemap] ${sitemap.urlCount} URLs`);

    console.log(`\nDone — ${created} created, ${updated} updated (${products.length} total).`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('seed:zellbury-lawn-2pc-2026 failed:', err.message);
  process.exit(1);
});
