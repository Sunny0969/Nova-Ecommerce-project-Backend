const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { regenerateSitemapAutopilot } = require('../lib/regenerateSitemapAutopilot');

/**
 * Writes frontend/public/sitemap.xml + robots.txt for Hostinger (Google Search Console).
 * Run after catalog changes and before `npm run build`.
 *
 * Usage (from repo root):
 *   node backend/scripts/generateSitemap.js
 *
 * Env: MONGODB_URI, FRONTEND_URL (prefer https://www.bazaar-pk.com)
 */
require('dotenv').config();

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is required.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const result = await regenerateSitemapAutopilot();
  if (!result.ok) {
    throw new Error(result.error || 'Sitemap generation failed');
  }

  console.log(`Wrote ${result.urlCount} URLs (${result.blogCount} blog posts)`);
  console.log(`Site base: ${result.siteUrl}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
