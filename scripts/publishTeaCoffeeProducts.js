/**
 * Publish approved Tea & Coffee products that have images.
 * Run: npm run publish:tea-coffee
 */
require('dotenv').config();
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();
const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { syncCategoryVisibility } = require('../lib/syncCategoryVisibility');
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');
const { flushAll } = require('../lib/apiCache');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);

  const cat = await Category.findOne({ slug: 'tea-coffee' }).select('_id name').lean();
  if (!cat) {
    console.error('tea-coffee category not found');
    process.exit(1);
  }

  const result = await Product.updateMany(
    {
      category: cat._id,
      isPublished: false,
      approvalStatus: 'approved',
      images: {
        $elemMatch: {
          url: { $exists: true, $type: 'string', $nin: [''] }
        }
      }
    },
    { $set: { isPublished: true } }
  );

  console.log(`Published ${result.modifiedCount} tea-coffee products`);

  await syncCategoryVisibility(Category, Product);
  flushAll();
  invalidateCatalogCache();

  const updated = await Category.findOne({ slug: 'tea-coffee' }).select('isActive name').lean();
  console.log(`Category "${updated.name}" isActive: ${updated.isActive}`);

  process.exit(0);
})();
