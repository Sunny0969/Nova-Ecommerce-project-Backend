/**
 * One-off: bump category product prices.
 * Run: node scripts/bumpCategoryPrices.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');

const BUMPS = [
  { slug: 'beverages', amount: 10 },
  { slug: 'tea-coffee', amount: 30 }
];

async function bumpCategory(slug, amount) {
  const cat = await Category.findOne({ slug, isActive: true }).select('_id name');
  if (!cat) throw new Error(`Category not found: ${slug}`);

  const res = await Product.updateMany({ category: cat._id }, { $inc: { price: amount } });
  const sample = await Product.find({ category: cat._id }).select('name price').sort({ name: 1 }).limit(3).lean();

  console.log(`${cat.name} (${slug}): +${amount} Rs on ${res.modifiedCount} products`);
  sample.forEach((p) => console.log(`  ${p.name} → Rs ${p.price}`));

  return res.modifiedCount;
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing');

  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  for (const { slug, amount } of BUMPS) {
    await bumpCategory(slug, amount);
  }
  await mongoose.disconnect();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
