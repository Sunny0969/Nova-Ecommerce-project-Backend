/**
 * Sync size & weight for Blue Pottery products from Punjab Handicrafts catalog.
 * Only sets fields when the source page provides them.
 *
 * Usage: node scripts/updateBluePotterySpecs.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Category = require('../models/Category');
const {
  resolvePunjabSlug,
  fetchPunjabProductSpecs
} = require('../lib/punjabHandicraftProductSpecs');
const { parseWeightStringToKg } = require('../lib/parseWeightKg');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');

  await mongoose.connect(uri);

  const category = await Category.findOne({ slug: 'blue-pottery' }).select('_id name').lean();
  if (!category) {
    throw new Error('Blue Pottery category not found in database');
  }

  const products = await Product.find({ category: category._id })
    .select('name slug productId size weight')
    .lean();

  console.log(`Found ${products.length} blue pottery product(s)\n`);

  let updated = 0;
  for (const product of products) {
    const punjabSlug = resolvePunjabSlug(product);
    let specs = { size: '', weight: '' };
    try {
      specs = await fetchPunjabProductSpecs(punjabSlug);
    } catch (err) {
      console.warn(`  skip ${product.name} (${punjabSlug}): ${err.message}`);
      continue;
    }

    const patch = {};
    if (specs.size) patch.size = specs.size.slice(0, 120);
    if (specs.weight) {
      patch.weight = specs.weight.slice(0, 120);
      const kg = parseWeightStringToKg(specs.weight);
      if (kg != null && kg > 0) patch.weightKg = kg;
    }

    if (!Object.keys(patch).length) {
      console.log(`  — ${product.name}: no size/weight on source`);
      continue;
    }

    await Product.updateOne({ _id: product._id }, { $set: patch });
    updated += 1;
    const parts = [];
    if (patch.size) parts.push(`size=${patch.size}`);
    if (patch.weight) parts.push(`weight=${patch.weight}`);
    console.log(`  ✓ ${product.name}: ${parts.join(', ')}`);
  }

  console.log(`\nDone — updated ${updated} product(s).`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
