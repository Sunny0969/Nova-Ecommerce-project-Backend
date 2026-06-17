/**
 * Cap sale discount by lowering comparePrice (list / actual price).
 * Selling price (price) is unchanged. Clothing & purses are skipped.
 *
 * Grocery: max 10% off (min 5% unchanged — only reduces when above max)
 * Other categories: max 20% off
 *
 * Run: npm run products:cap-sale-discounts
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

const SKIP_CATEGORY_SLUGS = new Set(['clothing', 'ladies-purse']);

function discountPercent(price, comparePrice) {
  const priceN = Number(price);
  const compareN = Number(comparePrice);
  if (!Number.isFinite(priceN) || !Number.isFinite(compareN) || compareN <= priceN || compareN <= 0) {
    return 0;
  }
  return ((compareN - priceN) / compareN) * 100;
}

/** comparePrice capped so discount is at most targetPct (whole PKR) */
function compareForDiscount(price, maxPct) {
  const priceN = Number(price);
  const pct = Number(maxPct);
  if (!Number.isFinite(priceN) || priceN <= 0 || pct <= 0 || pct >= 100) return null;

  let compare = Math.ceil(priceN / (1 - pct / 100));
  while (compare > priceN && discountPercent(priceN, compare) > pct + 0.001) {
    compare -= 1;
  }
  return compare > priceN ? compare : null;
}

function maxDiscountForSlug(slug) {
  return slug === 'grocery' ? 10 : 20;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);

  const categories = await Category.find({}).select('_id slug').lean();
  const slugById = new Map(categories.map((c) => [String(c._id), c.slug]));

  const products = await Product.find({
    comparePrice: { $gt: 0 },
    $expr: { $gt: ['$comparePrice', '$price'] }
  })
    .select('_id name price comparePrice category')
    .lean();

  const bulk = [];
  const stats = { grocery: 0, other: 0, skipped: 0 };

  for (const p of products) {
    const slug = slugById.get(String(p.category)) || '';
    if (SKIP_CATEGORY_SLUGS.has(slug)) {
      stats.skipped += 1;
      continue;
    }

    const current = discountPercent(p.price, p.comparePrice);
    const maxPct = maxDiscountForSlug(slug);
    if (current <= maxPct) continue;

    const newCompare = compareForDiscount(p.price, maxPct);
    if (!newCompare || newCompare <= p.price) continue;

    bulk.push({
      updateOne: {
        filter: { _id: p._id },
        update: { $set: { comparePrice: newCompare } }
      }
    });

    if (slug === 'grocery') stats.grocery += 1;
    else stats.other += 1;
  }

  let modified = 0;
  if (bulk.length) {
    const res = await Product.bulkWrite(bulk, { ordered: false });
    modified = res.modifiedCount;
  }

  flushAll();
  invalidateCatalogCache();

  console.log('Products checked:', products.length);
  console.log('Skipped (clothing / purses):', stats.skipped);
  console.log('Updated grocery (capped to 10%):', stats.grocery);
  console.log('Updated other (capped to 20%):', stats.other);
  console.log('Total modified:', modified);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
