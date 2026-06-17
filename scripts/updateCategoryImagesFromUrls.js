/**
 * Fix category hero images from CATEGORY_HERO_IMAGES (verified Unsplash URLs).
 * Run: npm run categories:images
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Category = require('../models/Category');
const { CATEGORY_HERO_IMAGES } = require('../lib/homeCategoriesSeed');
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');
const { flushAll } = require('../lib/apiCache');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);

  let updated = 0;
  for (const [slug, url] of Object.entries(CATEGORY_HERO_IMAGES)) {
    const res = await Category.updateOne(
      { slug },
      { $set: { image: { url: String(url).trim(), public_id: '' } } }
    );
    if (res.matchedCount) {
      updated += 1;
      console.log('✓', slug);
    } else {
      console.log('· skip (no category):', slug);
    }
  }

  flushAll();
  invalidateCatalogCache();
  console.log(`\nUpdated ${updated} category image(s).`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
