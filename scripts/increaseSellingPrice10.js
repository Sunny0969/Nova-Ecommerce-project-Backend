/**
 * Increase selling price (price) by 10% for all products except clothing & purses.
 * comparePrice / list price is unchanged.
 *
 * Run: npm run products:increase-price-10
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
const MULTIPLIER = 1.1;

function roundSellingPrice(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return null;
  return Math.round(v * MULTIPLIER);
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);

  const categories = await Category.find({}).select('_id slug').lean();
  const slugById = new Map(categories.map((c) => [String(c._id), c.slug]));
  const skipIds = new Set(
    categories.filter((c) => SKIP_CATEGORY_SLUGS.has(c.slug)).map((c) => String(c._id))
  );

  const products = await Product.find({}).select('_id name price category').lean();

  const bulk = [];
  let skipped = 0;

  for (const p of products) {
    if (skipIds.has(String(p.category))) {
      skipped += 1;
      continue;
    }

    const newPrice = roundSellingPrice(p.price);
    if (newPrice == null || newPrice === p.price) continue;

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

  flushAll();
  invalidateCatalogCache();

  console.log('Products total:', products.length);
  console.log('Skipped (clothing / purses):', skipped);
  console.log('Selling price increased by 10%:', modified);

  const sample = await Product.find({ category: { $nin: [...skipIds].map((id) => new mongoose.Types.ObjectId(id)) } })
    .select('name price')
    .limit(3)
    .lean();
  if (sample.length) {
    console.log('\nSample updated prices:');
    sample.forEach((p) => console.log(`  ${p.name.slice(0, 45)} → Rs ${p.price}`));
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
