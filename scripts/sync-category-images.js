/**
 * One-off: push category hero images from homeCategoriesSeed into MongoDB.
 * Usage: node backend/scripts/sync-category-images.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
const Category = require('../models/Category');
const { ensureHomeCategories, CATEGORY_HERO_IMAGES } = require('../lib/homeCategoriesSeed');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI required');
    process.exit(1);
  }
  await mongoose.connect(uri, MONGOOSE_CONNECT_OPTS);
  const result = await ensureHomeCategories(Category);
  console.log('Synced categories:', result.upserted);
  console.log('Hero image slugs:', Object.keys(CATEGORY_HERO_IMAGES).join(', '));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
