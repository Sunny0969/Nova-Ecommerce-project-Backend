require('dotenv').config();
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();
const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { publishedProductCountStages, syncCategoryVisibility } = require('../lib/syncCategoryVisibility');
const { flushAll } = require('../lib/apiCache');
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);

  // All categories with any published storefront-eligible products
  const allWithProducts = await Category.aggregate([
    ...publishedProductCountStages(Product.collection.name),
    { $match: { productCount: { $gt: 0 } } },
    { $project: { name: 1, slug: 1, isActive: 1, productCount: 1 } },
    { $sort: { name: 1 } }
  ]);

  console.log('Categories with published products:', allWithProducts.length);
  for (const r of allWithProducts) {
    console.log(`  [${r.isActive ? 'ON ' : 'OFF'}] ${r.slug} (${r.productCount})`);
  }

  const vis = await syncCategoryVisibility(Category, Product);
  flushAll();
  invalidateCatalogCache();
  console.log('\nSync done:', vis);

  process.exit(0);
})();
