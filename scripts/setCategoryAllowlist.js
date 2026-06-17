/**
 * Sync category visibility: active when category has published products, hidden when empty.
 * Replaces old allowlist — all categories with products show on homepage/shop.
 *
 * Run: npm run categories:sync
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');
const { regenerateSitemapAutopilot } = require('../lib/regenerateSitemapAutopilot');
const { syncCategoryVisibility } = require('../lib/syncCategoryVisibility');
const { flushAll } = require('../lib/apiCache');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);

  const vis = await syncCategoryVisibility(Category, Product);
  flushAll();
  invalidateCatalogCache();

  const active = await Category.find({ isActive: true })
    .select('slug name')
    .sort({ name: 1 })
    .lean();

  console.log(`[sync] ${vis.deactivated} hidden, ${vis.activated} active with products`);
  console.log('[sync] Storefront categories:');
  for (const c of active) {
    console.log(`  • ${c.name} (${c.slug})`);
  }

  const sitemap = await regenerateSitemapAutopilot();
  if (sitemap.ok) {
    console.log(`[sitemap] ${sitemap.urlCount} URLs written`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
