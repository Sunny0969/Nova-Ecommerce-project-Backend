/**
 * Set Imported Perfume category hero image.
 * Run: node scripts/setImportedPerfumeCategoryImage.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('../models/Category');
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');

const CATEGORY_SLUG = 'imported-perfume';
const CATEGORY_IMAGE_URL =
  'https://images.unsplash.com/photo-1635796332668-78830169097d?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8Nnx8aW1wb3J0ZWQlMjBwZXJmdW1lfGVufDB8MHwwfHx8Mg%3D%3D';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI missing');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const result = await Category.updateOne(
    { slug: CATEGORY_SLUG },
    {
      $set: {
        image: { url: CATEGORY_IMAGE_URL, public_id: '' }
      }
    }
  );

  if (result.matchedCount === 0) {
    console.error(`Category "${CATEGORY_SLUG}" not found`);
    process.exit(1);
  }

  invalidateCatalogCache();
  console.log(`Updated Imported Perfume category image (${result.modifiedCount ? 'changed' : 'already set'}).`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
