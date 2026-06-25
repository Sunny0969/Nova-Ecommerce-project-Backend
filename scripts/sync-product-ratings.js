/**
 * Recalculate ratings + numReviews on all products from Review collection.
 * Run: node scripts/sync-product-ratings.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Product = require('../models/Product');
const { recalculateProductRatings } = require('../utils/recalculateProductRatings');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  const ids = await Product.find({}).select('_id').lean();
  console.log(`Syncing ratings for ${ids.length} products…`);
  let updated = 0;
  for (const row of ids) {
    await recalculateProductRatings(row._id);
    updated += 1;
    if (updated % 100 === 0) console.log(`  ${updated}/${ids.length}`);
  }
  const withReviews = await Product.countDocuments({ numReviews: { $gt: 0 } });
  console.log(`Done. Products with reviews: ${withReviews}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
