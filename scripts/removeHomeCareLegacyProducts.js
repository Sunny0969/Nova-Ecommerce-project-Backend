/**
 * Remove pre-Imtiaz home-care products (migrated laundry/cleaning/tissues stock).
 * Keeps products imported via importImtiazHomeCareFromHtml.js (productId imtiaz_home_*).
 *
 * Run: node scripts/removeHomeCareLegacyProducts.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { syncCategoryVisibility } = require('../lib/syncCategoryVisibility');
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  const cat = await Category.findOne({ slug: 'home-care' }).select('_id name').lean();
  if (!cat) throw new Error('home-care category not found');

  const before = await Product.countDocuments({ category: cat._id, isPublished: true });
  const result = await Product.deleteMany({
    category: cat._id,
    productId: { $not: /^imtiaz_home_/ }
  });
  const after = await Product.countDocuments({ category: cat._id, isPublished: true });

  await syncCategoryVisibility(Category, Product);
  invalidateCatalogCache();

  console.log(`Removed ${result.deletedCount} legacy products from ${cat.name}.`);
  console.log(`Published before: ${before}, after: ${after}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
