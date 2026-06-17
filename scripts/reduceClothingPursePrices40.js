/**
 * Reduce selling price (price) by 40% for clothing & ladies-purse only.
 * comparePrice / list price is unchanged.
 *
 * Run: npm run products:reduce-clothing-purse-40
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');
const { flushAll } = require('../lib/apiCache');

const TARGET_CATEGORY_SLUGS = new Set(['clothing', 'ladies-purse']);
/** 40% off current selling price → pay 60% of today’s price */
const MULTIPLIER = 0.6;

function roundSellingPrice(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return null;
  return Math.max(1, Math.round(v * MULTIPLIER));
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing');

  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);

  const categories = await Category.find({ slug: { $in: [...TARGET_CATEGORY_SLUGS] } })
    .select('_id slug name')
    .lean();

  if (!categories.length) {
    throw new Error(`No categories found for: ${[...TARGET_CATEGORY_SLUGS].join(', ')}`);
  }

  const targetIds = categories.map((c) => c._id);
  const bySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));

  const products = await Product.find({ category: { $in: targetIds } })
    .select('_id name slug price category')
    .lean();

  const bulk = [];
  const perCategory = { clothing: 0, 'ladies-purse': 0 };

  for (const p of products) {
    const newPrice = roundSellingPrice(p.price);
    if (newPrice == null || newPrice === p.price) continue;

    bulk.push({
      updateOne: {
        filter: { _id: p._id },
        update: { $set: { price: newPrice } }
      }
    });

    const catSlug = categories.find((c) => String(c._id) === String(p.category))?.slug;
    if (catSlug && perCategory[catSlug] != null) perCategory[catSlug] += 1;
  }

  let modified = 0;
  if (bulk.length) {
    const res = await Product.bulkWrite(bulk, { ordered: false });
    modified = res.modifiedCount;
  }

  flushAll();
  invalidateCatalogCache();

  console.log('Categories:', categories.map((c) => `${c.name} (${c.slug})`).join(', '));
  console.log('Products matched:', products.length);
  console.log('Selling price reduced by 40%:', modified);
  console.log('  clothing:', perCategory.clothing);
  console.log('  ladies-purse:', perCategory['ladies-purse']);

  for (const slug of TARGET_CATEGORY_SLUGS) {
    const cat = bySlug[slug];
    if (!cat) continue;
    const samples = await Product.find({ category: cat._id })
      .select('name price comparePrice')
      .sort({ updatedAt: -1 })
      .limit(3)
      .lean();
    if (samples.length) {
      console.log(`\nSample (${slug}):`);
      samples.forEach((p) => {
        const cmp = p.comparePrice != null ? ` (was/compare ${p.comparePrice})` : '';
        console.log(`  ${p.name.slice(0, 50)} → Rs ${p.price}${cmp}`);
      });
    }
  }

  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
