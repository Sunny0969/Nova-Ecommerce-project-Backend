/**
 * Seed Ladies Purse category + 8 Zellbury crossbody bag products.
 *
 * Run:
 *   npm run seed:zellbury-crossbody-bags
 *   npm run seed:zellbury-crossbody-bags -- --force-images
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { uploadImageFile } = require('../lib/cloudinary');
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');
const { regenerateSitemapAutopilot } = require('../lib/regenerateSitemapAutopilot');

const CATEGORY_SLUG = 'ladies-purse';
const CATEGORY_NAME = 'Ladies Purse';
const IMAGE_DIR = path.join(__dirname, '..', 'seed-assets', 'zellbury-crossbody-bags');
const PRICE = 4299;
const COMPARE_PRICE = 4999;

const CATEGORY_IMAGE_URL =
  'https://images.unsplash.com/photo-1590874103328-eac07a683217?w=600&auto=format&fit=crop&q=60';

const PRODUCTS = [
  {
    productId: 'zellbury-crossbody-beige-chevron',
    imageFile: '01-beige-chevron.png',
    name: 'Zellbury Cross Body Quilted Chevron Bag — Classic Beige | Outlet Stock 2026',
    shortDescription:
      'Structured chevron-quilted crossbody in classic beige with gold turn-lock and chain strap.',
    color: 'Beige',
    tags: ['zellbury', 'crossbody', 'quilted', 'beige', 'ladies purse', 'outlet', '2026'],
    description: `
<h2>Zellbury Cross Body Quilted Chevron Bag — Classic Beige</h2>
<p>Part of the <strong>Zellbury Cross Body 💯 Outlet Stock Bags Collection 2026</strong>.</p>
<h3>Material</h3>
<p>Heavy duty canvas — stylish and long lasting, with a smooth quilted finish.</p>
<h3>Design</h3>
<p>Elegant V-shaped chevron quilting on the front flap, polished gold turn-lock closure, and a gold-tone chain strap for crossbody or shoulder wear.</p>
<p>Compact yet roomy — ideal for daily outings, shopping, and evening wear.</p>
`.trim()
  },
  {
    productId: 'zellbury-crossbody-white-chevron',
    imageFile: '02-white-chevron.png',
    name: 'Zellbury Cross Body Quilted Chevron Bag — Arctic White | Outlet Stock 2026',
    shortDescription:
      'Crisp white chevron-quilted crossbody with gold hardware and interwoven chain strap.',
    color: 'White',
    tags: ['zellbury', 'crossbody', 'quilted', 'white', 'ladies purse', 'outlet', '2026'],
    description: `
<h2>Zellbury Cross Body Quilted Chevron Bag — Arctic White</h2>
<p>From the <strong>Zellbury Cross Body 💯 Outlet Stock Bags Collection 2026</strong>.</p>
<h3>Material</h3>
<p>Heavy duty canvas construction — stylish and long lasting with a clean matte surface.</p>
<h3>Design</h3>
<p>Fresh arctic white body with chevron quilt stitching, shield-style gold clasp, and a chain strap woven with matching white material.</p>
<p>A versatile neutral that pairs effortlessly with casual and formal outfits.</p>
`.trim()
  },
  {
    productId: 'zellbury-crossbody-mustard-quilted',
    imageFile: '03-mustard-quilted.png',
    name: 'Zellbury Cross Body Quilted Bag — Mustard Yellow | Outlet Stock 2026',
    shortDescription:
      'Vibrant mustard crossbody with honeycomb quilting, gold bar accent, and chain strap.',
    color: 'Mustard Yellow',
    tags: ['zellbury', 'crossbody', 'quilted', 'mustard', 'ladies purse', 'outlet', '2026'],
    description: `
<h2>Zellbury Cross Body Quilted Bag — Mustard Yellow</h2>
<p>Exclusive pick from the <strong>Zellbury Cross Body 💯 Outlet Stock Bags Collection 2026</strong>.</p>
<h3>Material</h3>
<p>Heavy duty canvas — stylish and long lasting, finished with fine-grain texture.</p>
<h3>Design</h3>
<p>Bold mustard yellow shade with vertical honeycomb quilting, slim gold bar on the flap, and a delicate gold chain strap.</p>
<p>Adds a pop of colour to everyday looks while keeping essentials organised.</p>
`.trim()
  },
  {
    productId: 'zellbury-crossbody-sage-sunflower',
    imageFile: '04-sage-sunflower.png',
    name: 'Zellbury Sunflower Embroidered Crossbody — Sage Green | Outlet Stock 2026',
    shortDescription:
      'Sage green flap bag with sunflower embroidery, Zellbury branding, and gold chain strap.',
    color: 'Sage Green',
    tags: ['zellbury', 'crossbody', 'embroidered', 'floral', 'ladies purse', 'outlet', '2026'],
    description: `
<h2>Zellbury Sunflower Embroidered Crossbody — Sage Green</h2>
<p>Featured in the <strong>Zellbury Cross Body 💯 Outlet Stock Bags Collection 2026</strong>.</p>
<h3>Material</h3>
<p>Heavy duty canvas — stylish and long lasting with tonal edge stitching.</p>
<h3>Design</h3>
<p>Muted sage green body adorned with hand-style sunflower embroidery in yellow and brown, plus embroidered Zellbury branding on the flap.</p>
<p>Gold chain strap and structured boxy shape complete this statement crossbody.</p>
`.trim()
  },
  {
    productId: 'zellbury-crossbody-blush-knotted',
    imageFile: '05-blush-knotted.png',
    name: 'Zellbury Knotted Handle Half-Moon Crossbody — Blush Pink | Outlet Stock 2026',
    shortDescription:
      'Half-moon blush bag with signature knotted top handle and detachable shoulder strap.',
    color: 'Blush Pink',
    tags: ['zellbury', 'crossbody', 'knotted handle', 'pink', 'ladies purse', 'outlet', '2026'],
    description: `
<h2>Zellbury Knotted Handle Half-Moon Crossbody — Blush Pink</h2>
<p>From the <strong>Zellbury Cross Body 💯 Outlet Stock Bags Collection 2026</strong>.</p>
<h3>Material</h3>
<p>Heavy duty canvas — stylish and long lasting with a soft matte finish.</p>
<h3>Design</h3>
<p>Distinctive semi-circular silhouette, decorative knotted top handle, and gold twist-lock on the front flap.</p>
<p>Includes a matching detachable adjustable strap — carry by hand or wear crossbody.</p>
`.trim()
  },
  {
    productId: 'zellbury-crossbody-peach-braided',
    imageFile: '06-peach-braided.png',
    name: 'Zellbury Braided Handle Crescent Bag — Peach Nude | Outlet Stock 2026',
    shortDescription:
      'Peach nude crescent bag with braided top handle, gold hardware, and detachable strap.',
    color: 'Peach Nude',
    tags: ['zellbury', 'crossbody', 'braided handle', 'peach', 'ladies purse', 'outlet', '2026'],
    description: `
<h2>Zellbury Braided Handle Crescent Bag — Peach Nude</h2>
<p>Part of the <strong>Zellbury Cross Body 💯 Outlet Stock Bags Collection 2026</strong>.</p>
<h3>Material</h3>
<p>Heavy duty canvas — stylish and long lasting with neat perimeter stitching.</p>
<h3>Design</h3>
<p>Soft peach nude crescent shape, thick braided top handle, and curved front stitching detail.</p>
<p>Detachable shoulder strap with gold lobster clasps — perfect for brunches, work, or evenings out.</p>
`.trim()
  },
  {
    productId: 'zellbury-crossbody-beige-sunflower',
    imageFile: '07-beige-sunflower.png',
    name: 'Zellbury Sunflower Embroidered Crossbody — Sand Beige | Outlet Stock 2026',
    shortDescription:
      'Sand beige crossbody with sunflower embroidery, Zellbury logo, and gold chain strap.',
    color: 'Sand Beige',
    tags: ['zellbury', 'crossbody', 'embroidered', 'floral', 'ladies purse', 'outlet', '2026'],
    description: `
<h2>Zellbury Sunflower Embroidered Crossbody — Sand Beige</h2>
<p>From the <strong>Zellbury Cross Body 💯 Outlet Stock Bags Collection 2026</strong>.</p>
<h3>Material</h3>
<p>Heavy duty canvas — stylish and long lasting, built for everyday use.</p>
<h3>Design</h3>
<p>Neutral sand beige flap bag with vibrant sunflower embroidery, Zellbury name detail, and chunky gold chain strap.</p>
<p>Structured rectangular shape keeps your phone, wallet, and keys secure on the go.</p>
`.trim()
  },
  {
    productId: 'zellbury-crossbody-black-buckle',
    imageFile: '08-black-buckle.png',
    name: 'Zellbury Gold Buckle Flap Crossbody — Midnight Black | Outlet Stock 2026',
    shortDescription:
      'Matte black structured crossbody with statement gold square buckle and chain strap.',
    color: 'Black',
    tags: ['zellbury', 'crossbody', 'black', 'gold buckle', 'ladies purse', 'outlet', '2026'],
    description: `
<h2>Zellbury Gold Buckle Flap Crossbody — Midnight Black</h2>
<p>Closing out the <strong>Zellbury Cross Body 💯 Outlet Stock Bags Collection 2026</strong>.</p>
<h3>Material</h3>
<p>Heavy duty canvas — stylish and long lasting with a smooth matte black finish.</p>
<h3>Design</h3>
<p>Sleek boxy silhouette, front flap with vertical strap, and a bold polished gold square buckle.</p>
<p>Fine gold chain strap adds elegance — a timeless piece for day-to-night styling.</p>
`.trim()
  }
];

function imagePath(filename) {
  const full = path.join(IMAGE_DIR, filename);
  if (!fs.existsSync(full)) throw new Error(`Missing image: ${full}`);
  return full;
}

async function ensureCategory() {
  let cat = await Category.findOne({ slug: CATEGORY_SLUG });
  const payload = {
    name: CATEGORY_NAME,
    slug: CATEGORY_SLUG,
    description: 'Stylish ladies purses, crossbody bags, and handbags — outlet stock collections.',
    isActive: true,
    displayOrder: 19,
    image: { url: CATEGORY_IMAGE_URL, public_id: '' }
  };

  if (cat) {
    await Category.updateOne({ _id: cat._id }, { $set: payload });
    return Category.findById(cat._id);
  }
  return Category.create(payload);
}

async function uploadProductImage(spec, force) {
  const existing = await Product.findOne({ productId: spec.productId }).select('images').lean();
  if (
    !force &&
    existing?.images?.length &&
    existing.images.some((img) => String(img.public_id || '').includes('zellbury-crossbody'))
  ) {
    return existing.images;
  }

  const file = imagePath(spec.imageFile);
  const uploaded = await uploadImageFile(file, {
    folder: `nova-shop/products/${CATEGORY_SLUG}`,
    public_id: spec.productId
  });
  return [uploaded];
}

async function upsertProduct(spec, categoryId, forceImages) {
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
    tags: spec.tags,
    color: spec.color,
    size: '',
    weight: 'Crossbody handbag',
    weightKg: 0.35,
    variantAxes: {
      color: { enabled: false, selectionMode: 'single', options: [] },
      shape: { enabled: false, selectionMode: 'single', options: [] },
      size: { enabled: false, selectionMode: 'single', options: [] }
    },
    stock: 25,
    lowStockThreshold: 3,
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

  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  try {
    const category = await ensureCategory();
    console.log(`Category: ${category.name} (${category.slug})\n`);

    for (const spec of PRODUCTS) {
      const { product, action } = await upsertProduct(spec, category._id, forceImages);
      console.log(`${action}: ${product.name}`);
      console.log(`  slug: /${CATEGORY_SLUG}/${product.slug}`);
    }

    invalidateCatalogCache();
    const sitemap = await regenerateSitemapAutopilot();
    if (sitemap.ok) console.log(`\n[sitemap] ${sitemap.urlCount} URLs`);

    console.log('\nDone — 8 Zellbury crossbody products in Ladies Purse.');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('seed:zellbury-crossbody-bags failed:', err.message);
  process.exit(1);
});
