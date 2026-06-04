/**
 * Seed homepage browse categories with Unsplash images.
 * Run from backend: npm run seed:categories
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Category = require('../models/Category');
const { ensureHomeCategories, HOME_CATEGORY_SPECS } = require('../lib/homeCategoriesSeed');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set. Add it to backend/.env');
  process.exit(1);
}

async function main() {
  await mongoose.connect(MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  console.log('Connected to MongoDB');

  const { upserted } = await ensureHomeCategories(Category);
  console.log(`Upserted ${upserted} homepage categories:`);
  HOME_CATEGORY_SPECS.forEach((c) => console.log(`  - ${c.name} (${c.slug})`));

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
