/**
 * Keep only allowlisted categories active; deactivate all others.
 * Unpublish products in deactivated categories.
 *
 * Run:
 *   node scripts/setCategoryAllowlist.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');

const ACTIVE_SLUGS = [
  'sauces-dressings-seasonings',
  'spreads',
  'traditional-dessert-mixes',
  'oral-care',
  'body-skin-care',
  'facial-care',
  'personal-hygiene',
  'feminine-care',
  'milk-dairy',
  'baby-care',
  'hair-care',
  'clothing'
];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);

  const activeSet = new Set(ACTIVE_SLUGS.map((s) => s.toLowerCase()));
  const all = await Category.find({}).lean();

  let activated = 0;
  let deactivated = 0;

  for (const cat of all) {
    const slug = String(cat.slug || '').toLowerCase();
    const shouldActive = activeSet.has(slug);
    if (cat.isActive !== shouldActive) {
      await Category.updateOne({ _id: cat._id }, { $set: { isActive: shouldActive } });
    }
    if (shouldActive) {
      activated += 1;
      console.log('ON ', slug, cat.name);
    } else {
      deactivated += 1;
      console.log('OFF', slug, cat.name);
    }
  }

  const activeIds = all.filter((c) => activeSet.has(String(c.slug).toLowerCase())).map((c) => c._id);
  const inactiveIds = all.filter((c) => !activeSet.has(String(c.slug).toLowerCase())).map((c) => c._id);

  const unpublished = await Product.updateMany(
    { category: { $in: inactiveIds }, isPublished: true },
    { $set: { isPublished: false } }
  );

  const publishedInActive = await Product.countDocuments({
    category: { $in: activeIds },
    isPublished: true,
    approvalStatus: 'approved'
  });

  invalidateCatalogCache();

  console.log('\nDone.', {
    activeCategories: activated,
    inactiveCategories: deactivated,
    productsUnpublished: unpublished.modifiedCount,
    publishedProductsInActiveCategories: publishedInActive
  });

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
