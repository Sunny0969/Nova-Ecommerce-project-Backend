/**
 * Set comparePrice (list / actual price) on products in active categories.
 * Uses category-aware sale caps (grocery 5–10%, others 5–20%; clothing/purses skipped).
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

const SKIP_CATEGORY_SLUGS = new Set(['clothing', 'ladies-purse']);

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function discountRangeForSlug(slug) {
  return slug === 'grocery' ? { min: 5, max: 10 } : { min: 5, max: 20 };
}

function compareForDiscount(price, targetPct) {
  const priceN = Number(price);
  const pct = Number(targetPct);
  if (!Number.isFinite(priceN) || priceN <= 0 || pct <= 0 || pct >= 100) return null;
  let compare = Math.ceil(priceN / (1 - pct / 100));
  while (compare > priceN && ((compare - priceN) / compare) * 100 > pct + 0.001) {
    compare -= 1;
  }
  return compare > priceN ? compare : null;
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

  const slugById = new Map(activeCats.map((c) => [String(c._id), c.slug]));

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
    const slug = slugById.get(String(p.category)) || '';
    if (SKIP_CATEGORY_SLUGS.has(slug)) continue;

    const price = Number(p.price);
    if (!Number.isFinite(price) || price < 0) continue;

    const { min, max } = discountRangeForSlug(slug);
    const targetPct = randomInt(min, max);
    const comparePrice = compareForDiscount(price, targetPct);
    if (!comparePrice || comparePrice <= price) continue;

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
  console.log('Sale range: grocery 5–10%, other categories 5–20% (clothing/purses skipped)');
  console.log('\nSample:');
  samples.forEach((p) => {
    const diff = Number(p.comparePrice) - Number(p.price);
    const pct = p.comparePrice > p.price ? Math.round((diff / p.comparePrice) * 100) : 0;
    console.log(`  ${p.name}`);
    console.log(`    Selling: Rs ${p.price}  |  List: Rs ${p.comparePrice}  (${pct}% off)`);
  });

  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
