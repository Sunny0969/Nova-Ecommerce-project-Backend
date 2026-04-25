/**
 * Re-run product save hooks so every `slug` is derived from the current `name` (title).
 * Use after changing slug rules. Run: node scripts/resyncProductSlugsFromNames.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Product = require('../models/Product');

async function run() {
  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) {
    console.error('MONGODB_URI is not set');
    process.exit(1);
  }
  await mongoose.connect(MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  const products = await Product.find();
  let n = 0;
  for (const p of products) {
    const before = p.slug;
    const title = p.name;
    await p.save();
    if (p.slug !== before) {
      n += 1;
      console.log(`[slug] ${title}\n  ${before}  →  ${p.slug}`);
    }
  }
  console.log(
    `[slug] Changed ${n} of ${products.length} slugs to match each product title.`
  );
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
