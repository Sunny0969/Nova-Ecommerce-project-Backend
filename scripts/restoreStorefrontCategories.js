/**
 * Restore storefront categories: republish approved products and sync visibility.
 * Run: npm run categories:restore
 */
const mongoose = require('mongoose');
require('dotenv').config();
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { syncCategoryVisibility } = require('../lib/syncCategoryVisibility');

configureMongoDns();

async function run() {
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      console.error('MONGODB_URI is not set');
      process.exit(1);
    }
    await mongoose.connect(uri, MONGOOSE_CONNECT_OPTS);
    console.log('[MongoDB] Connected');

    const republish = await Product.updateMany(
      {
        category: { $exists: true, $ne: null },
        approvalStatus: { $in: ['approved', 'pending_approval'] }
      },
      { $set: { isPublished: true } }
    );
    console.log(`[restore] Republished ${republish.modifiedCount || 0} products`);

    const vis = await syncCategoryVisibility(Category, Product);
    const active = await Category.find({ isActive: true })
      .sort({ displayOrder: 1, name: 1 })
      .select('slug name')
      .lean();

    console.log(`[restore] ${vis.activated} categories active, ${vis.deactivated} hidden`);
    console.log(`[restore] ${active.length} categories on homepage:`);
    active.forEach((c) => console.log(`  - ${c.name} (${c.slug})`));

    process.exit(0);
  } catch (err) {
    console.error('categories:restore failed:', err.message);
    process.exit(1);
  }
}

run();
