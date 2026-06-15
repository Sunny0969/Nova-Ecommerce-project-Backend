/**
 * Update Spreads and Sauces category hero images.
 * Run: node scripts/setSpreadsSaucesCategoryImages.js
 */
require('dotenv').config();
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Category = require('../models/Category');
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');

const UPDATES = [
  {
    slug: 'spreads',
    url: 'https://images.unsplash.com/photo-1642941949520-f44967c00500?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8Nnx8c3ByZWFkc3xlbnwwfDB8MHx8fDI%3D'
  },
  {
    slug: 'sauces-dressings-seasonings',
    url: 'https://images.unsplash.com/photo-1472476443507-c7a5948772fc?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8Mnx8c2F1Y2VzfGVufDB8MHwwfHx8Mg%3D%3D'
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
