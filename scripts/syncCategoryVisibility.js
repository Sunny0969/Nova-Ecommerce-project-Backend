/**
 * Hide categories with no published products; show categories that have stock.
 * Run: npm run categories:sync
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

    const vis = await syncCategoryVisibility(Category, Product);
    const active = await Category.find({ isActive: true }).select('slug name').lean();
    console.log(`[sync] ${vis.deactivated} categories hidden, ${vis.activated} now active`);
    console.log('[sync] Active categories:', active.map((c) => c.slug).join(', ') || '(none)');

    process.exit(0);
  } catch (err) {
    console.error('categories:sync failed:', err.message);
    process.exit(1);
  }
}

run();
