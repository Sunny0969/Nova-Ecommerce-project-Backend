/**
 * Increase clothing category prices by 75%, except one excluded product.
 *
 * Run:
 *   node scripts/bumpClothingPrices75.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');

const CATEGORY_SLUG = 'clothing';
const EXCLUDE_SLUG = 'zellbury-express-outlet-stock-wash-and-wear-2-pcs-unstitched-collection-2026';
const MULTIPLIER = 1.75;

function roundPrice(n) {
  return Math.round(Number(n) * 100) / 100;
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing');

  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);

  const cat = await Category.findOne({ slug: CATEGORY_SLUG }).select('_id name').lean();
  if (!cat) throw new Error(`Category not found: ${CATEGORY_SLUG}`);

  const excluded = await Product.findOne({ slug: EXCLUDE_SLUG }).select('name price').lean();
  if (!excluded) {
    console.warn(`Warning: excluded product not found (${EXCLUDE_SLUG}) — continuing anyway.`);
  } else {
    console.log(`Excluded (unchanged): ${excluded.name} — Rs ${excluded.price}`);
  }

  const products = await Product.find({
    category: cat._id,
    slug: { $ne: EXCLUDE_SLUG }
  })
    .select('_id name slug price comparePrice')
    .lean();

  const bulk = [];
  for (const p of products) {
    const oldPrice = Number(p.price);
    if (!Number.isFinite(oldPrice) || oldPrice < 0) continue;

    const newPrice = Math.round(oldPrice * MULTIPLIER);
    bulk.push({
      updateOne: {
        filter: { _id: p._id },
        update: { $set: { price: newPrice } }
      }
    });
  }

  let modified = 0;
  if (bulk.length) {
    const res = await Product.bulkWrite(bulk, { ordered: false });
    modified = res.modifiedCount;
  }

  invalidateCatalogCache();

  const samples = await Product.find({ category: cat._id })
    .select('name slug price')
    .sort({ updatedAt: -1 })
    .limit(5)
    .lean();

  console.log(`\n${cat.name}: +75% on ${modified} / ${products.length} products`);
  console.log('\nSample after update:');
  samples.forEach((p) => {
    const tag = p.slug === EXCLUDE_SLUG ? ' (excluded)' : '';
    console.log(`  ${p.name}${tag} → Rs ${p.price}`);
  });

  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
