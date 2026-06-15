/**
 * Update Body & Skin Care and Oral Care category hero images.
 * Run: node scripts/setBodyOralCategoryImages.js
 */
require('dotenv').config();
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Category = require('../models/Category');
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');

const UPDATES = [
  {
    slug: 'body-skin-care',
    url: 'https://images.unsplash.com/photo-1581839900425-988f51ac74e4?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MTF8fGJvc3klMjBhbmQlMjBza2luJTIwY2FyZXxlbnwwfDB8MHx8fDI%3D'
  },
  {
    slug: 'oral-care',
    url: 'https://images.unsplash.com/photo-1676897288522-e8a081e71430?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8NHx8b3JhbCUyMGNhcmV8ZW58MHwwfDB8fHwy'
  }
];

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI missing');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);

  for (const { slug, url } of UPDATES) {
    const result = await Category.updateOne(
      { slug },
      { $set: { image: { url, public_id: '' } } }
    );

    if (result.matchedCount === 0) {
      console.error(`Category not found: ${slug}`);
      continue;
    }

    const cat = await Category.findOne({ slug }).select('name').lean();
    console.log(`${cat?.name || slug}: ${result.modifiedCount ? 'image updated' : 'already set'}`);
  }

  invalidateCatalogCache();
  await mongoose.disconnect();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
