/**
 * CLI: inserts 3 dummy products if their productIds are not already in the DB.
 * Run: npm run seed:sample
 */
const mongoose = require('mongoose');
require('dotenv').config();
const {
  configureMongoDns,
  MONGOOSE_CONNECT_OPTS
} = require('../lib/configureMongoDns');
configureMongoDns();
const { insertSampleProducts } = require('../lib/sampleProductsSeed');

async function run() {
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      console.error('MONGODB_URI is not set. Add it to backend/.env');
      process.exit(1);
    }
    await mongoose.connect(uri, MONGOOSE_CONNECT_OPTS);
    console.log('Connected to MongoDB');

    const { added, skipped, total } = await insertSampleProducts();
    console.log(`Done. Added ${added}, skipped ${skipped}. Total products: ${total}`);
    process.exit(0);
  } catch (err) {
    console.error('seed:sample failed:', err.message);
    process.exit(1);
  }
}

run();
