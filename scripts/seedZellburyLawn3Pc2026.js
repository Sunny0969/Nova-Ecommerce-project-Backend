/**
 * Seed 34 Zellbury Printed Lawn 3 Pcs Unstitched products (women, 3-piece).
 *
 * Run:
 *   npm run seed:zellbury-lawn-3pc-2026
 *   npm run seed:zellbury-lawn-3pc-2026 -- --force-images
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

const IMAGE_DIR = path.join(__dirname, '..', 'seed-assets', 'zellbury-lawn-3pc-2026');
const PRICE = 4321;
const COMPARE_PRICE = 4899;
const ID_PREFIX = 'zellbury-lawn-3pc-2026';

const COLOR_NAMES = [
  'Beige Cream Floral',
  'Soft Lilac Print',
  'Ivory Garden Bloom',
  'Dusty Rose Paisley',
  'Ocean Teal Floral',
  'Mint Sage Classic',
  'Golden Amber Stripe',
  'Coral Sunset',
  'Peach Blossom',
  'Mustard Yellow Angrakha',
  'Honey Gold Geo',
  'Pistachio Green',
  'Ruby Crimson',
  'Indigo Night Floral',
  'Mauve Elegance',
  'Rose Petal Pink',
  'Sky Azure Print',
  'Wine Maroon',
  'Jade Emerald',
  'Charcoal Grey Bloom',
  'Lavender Mist Floral',
  'Orchid Purple',
  'Sunshine Yellow Chevron',
  'Plum Burgundy Stripe',
  'Peach Paisley Border',
  'Black Purple Floral',
  'Cream Royal Blue Rose',
  'Black Olive Scallop',
  'Teal Pink Blossom',
  'Forest Green Ajrak',
  'Emerald Green Geo',
  'Navy Pink Geometric',
  'Coral Red & Cream',
  'Mustard Grid Print'
];

function buildShortDescription(color, idx) {
  const lines = [
    `${color} 3-piece unstitched lawn — digital printed shirt, dupatta, and dyed cambric trouser.`,
    `Zellbury outlet stock ${color} lawn suit: printed shirt & dupatta with cambric trouser.`,
    `Women's unstitched 3-piece lawn in ${color} — premium digital print collection 2026.`,
    `${color} lawn 3-piece set with digital printed shirt, dupatta, and dyed cambric trouser.`,
    `Summer lawn 3-piece unstitched suit in ${color} from Zellbury 2026 outlet collection.`
  ];
  return lines[idx % lines.length];
}

function buildDescription(color, idx) {
  const intros = [
    `Elegant ${color} tones from the Zellbury outlet stock lawn 3-piece range.`,
    `Fresh ${color} digital prints for a complete summer 3-piece look.`,
    `A standout ${color} 3-piece from the 2026 Zellbury collection.`,
    `Premium lawn in ${color} — stitch the shirt, dupatta, and trouser your way.`,
    `Vibrant ${color} palette with crisp digital print quality on every piece.`
  ];
  const shirtLines = [
    'Digital printed lawn shirt with rich colour and fine print detail.',
    'Premium digital printed lawn shirt — lightweight, breathable summer lawn.',
    'Digital printed lawn shirt featuring sharp motifs and a smooth finish.',
    'High-quality digital printed lawn shirt, ideal for custom tailoring.'
  ];
  const dupattaLines = [
    'Digital printed lawn dupatta with complementary print and border detail.',
    'Matching digital printed lawn dupatta to pair with the shirt.',
    'Digital printed lawn dupatta with coordinated motifs and finishing.',
    'Coordinating digital printed lawn dupatta included in the set.'
  ];
  const trouserLines = [
    'Dyed cambric trouser in a solid matching shade — smooth finish, easy to stitch.',
    'Dyed cambric trouser fabric — durable, comfortable, and colour-fast.',
    'Dyed cambric trouser piece to complete the 3-piece lawn suit.',
    'Premium dyed cambric trouser — soft hand-feel and lasting colour.'
  ];
  return `
<h2>Zellbury Printed Lawn 3 Pcs Unstitched — ${color}</h2>
<p><strong>Zellbury Printed 💯 Outlet Stock Lawn 3 Pcs Unstitched Collection 2026!</strong></p>
<p>${intros[idx % intros.length]}</p>
<h3>👕 Shirt</h3>
<p>${shirtLines[idx % shirtLines.length]}</p>
<h3>🎗️ Dupatta</h3>
<p>${dupattaLines[idx % dupattaLines.length]}</p>
<h3>👖 Trouser</h3>
<p>${trouserLines[idx % trouserLines.length]}</p>
<p>Unstitched 3-piece set — perfect for casual wear, outings, and festive summer dressing.</p>
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
      name: `Zellbury Printed 💯 Outlet Stock Lawn 3 Pcs Unstitched — ${color} | Collection 2026`,
      color,
      shortDescription: buildShortDescription(color, i),
      description: buildDescription(color, i),
      tags: [
        'zellbury',
        'lawn',
        '3-piece',
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
    weight: 'Unstitched lawn 3-piece suit',
    weightKg: 0.55,
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

  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI missing in backend/.env');
    process.exit(1);
  }

  const products = buildProducts();

  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  try {
    const clothing = await Category.findOne({ slug: 'clothing', isActive: true });
    if (!clothing) throw new Error('Clothing category not found');

    const subcategoryId = await resolveWomen3PieceSubcategory(clothing._id);
    if (!subcategoryId) {
      console.warn('[warn] Women 3-piece subcategory not found — run npm run categories:clothing-filters');
    }

    console.log(`Seeding ${products.length} Zellbury lawn 3-piece products…\n`);

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
  console.error('seed:zellbury-lawn-3pc-2026 failed:', err.message);
  process.exit(1);
});
