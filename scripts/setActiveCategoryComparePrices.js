/**
 * Set comparePrice (list / actual price) on products in active categories.
 * comparePrice = selling price + random Rs 50–500 (per product).
 *
 * Run:
 *   node scripts/setActiveCategoryComparePrices.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');

const MIN_MARKUP = 50;
const MAX_MARKUP = 500;

function randomMarkup() {
  return Math.floor(Math.random() * (MAX_MARKUP - MIN_MARKUP + 1)) + MIN_MARKUP;
}

function roundPrice(n) {
  return Math.round(Number(n) * 100) / 100;
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing');

  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);

  const activeCats = await Category.find({ isActive: true }).select('_id slug name').lean();
  const activeIds = activeCats.map((c) => c._id);

  if (!activeIds.length) {
    console.log('No active categories found.');
    await mongoose.disconnect();
    return;
  }

  const products = await Product.find({ category: { $in: activeIds } })
    .select('_id name price comparePrice category')
    .lean();

  if (!products.length) {
    console.log('No products in active categories.');
    await mongoose.disconnect();
    return;
  }

  const bulk = [];
  for (const p of products) {
    const price = Number(p.price);
    if (!Number.isFinite(price) || price < 0) continue;

    const comparePrice = roundPrice(price + randomMarkup());
    if (comparePrice <= price) continue;

    bulk.push({
      updateOne: {
        filter: { _id: p._id },
        update: { $set: { comparePrice } }
      }
    });
  }

  let modified = 0;
  if (bulk.length) {
    const res = await Product.bulkWrite(bulk, { ordered: false });
    modified = res.modifiedCount;
  }

  invalidateCatalogCache();

  const samples = await Product.find({ category: { $in: activeIds } })
    .select('name price comparePrice')
    .sort({ updatedAt: -1 })
    .limit(5)
    .lean();

  console.log(`Active categories: ${activeCats.length}`);
  console.log(`Products updated: ${modified} / ${products.length}`);
  console.log(`Markup range: +Rs ${MIN_MARKUP} to +Rs ${MAX_MARKUP} above selling price`);
  console.log('\nSample:');
  samples.forEach((p) => {
    const diff = roundPrice(Number(p.comparePrice) - Number(p.price));
    console.log(`  ${p.name}`);
    console.log(`    Selling: Rs ${p.price}  |  List: Rs ${p.comparePrice}  (+Rs ${diff})`);
  });

  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
