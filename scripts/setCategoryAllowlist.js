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
const { regenerateSitemapAutopilot } = require('../lib/regenerateSitemapAutopilot');

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
  'clothing',
  'ladies-purse'
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

  const sitemap = await regenerateSitemapAutopilot();
  if (sitemap.ok) {
    console.log(`[sitemap] ${sitemap.urlCount} URLs written`);
  } else {
    console.warn('[sitemap] regeneration failed:', sitemap.error);
  }

  const apiBase = String(
    process.env.PUBLIC_API_URL ||
      process.env.REACT_APP_API_URL ||
      'https://nova-ecommerce-project-backend-production.up.railway.app'
  ).replace(/\/+$/, '');
  const flushSecret = String(process.env.CACHE_FLUSH_SECRET || '').trim();
  if (flushSecret) {
    try {
      const res = await fetch(`${apiBase}/api/internal/cache/flush`, {
        method: 'POST',
        headers: { 'X-Cache-Flush-Secret': flushSecret }
      });
      const body = await res.json().catch(() => ({}));
      console.log('[cache]', res.ok ? 'Production API cache cleared' : body.message || res.status);
    } catch (err) {
      console.warn('[cache] Could not flush production cache:', err.message);
      console.warn('[cache] Restart the Railway backend service or wait up to 1 hour for cache TTL.');
    }
  } else {
    console.warn(
      '[cache] Set CACHE_FLUSH_SECRET in .env and Railway, then re-run — or restart Railway backend to clear stale category/product cache.'
    );
  }

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
