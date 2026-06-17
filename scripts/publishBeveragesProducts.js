/**
 * Publish approved Beverages products that have images.
 * Run: node scripts/publishBeveragesProducts.js
 */
require('dotenv').config();
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();
const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { syncCategoryVisibility } = require('../lib/syncCategoryVisibility');
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);

  const cat = await Category.findOne({ slug: 'beverages' }).select('_id name').lean();
  if (!cat) {
    console.error('beverages category not found');
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

  console.log(`Published ${result.modifiedCount} beverages products`);

  const vis = await syncCategoryVisibility(Category, Product);
  invalidateCatalogCache();

  const updated = await Category.findOne({ slug: 'beverages' }).select('isActive name').lean();
  console.log(`Category "${updated.name}" isActive: ${updated.isActive}`);
  console.log(`[sync] ${vis.deactivated} hidden, ${vis.activated} active`);

  process.exit(0);
})();
