/**
 * Backfill product.weightKg from weight text (e.g. "1.6 kg", "280 g").
 * Run: npm run products:sync-weight-kg
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../models/Product');
const { parseWeightStringToKg } = require('../lib/parseWeightKg');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('Set MONGODB_URI in .env');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const products = await Product.find({})
    .select('name slug weight weightKg')
    .lean();

  let updated = 0;
  let skipped = 0;

  for (const p of products) {
    const hasKg =
      p.weightKg != null && Number.isFinite(Number(p.weightKg)) && Number(p.weightKg) > 0;
    if (hasKg) {
      skipped += 1;
      continue;
    }

    const parsed = parseWeightStringToKg(p.weight);
    if (parsed == null || parsed <= 0) {
      skipped += 1;
      continue;
    }

    await Product.updateOne({ _id: p._id }, { $set: { weightKg: parsed } });
    updated += 1;
    console.log(`  ✓ ${p.name}: ${parsed} kg (from "${p.weight}")`);
  }

  console.log(`\nDone. Updated ${updated}, skipped ${skipped}, total ${products.length}.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
