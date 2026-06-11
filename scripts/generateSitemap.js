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
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { buildSitemapXml } = require('../lib/buildSitemap');
const { buildRobotsTxt } = require('../lib/seoRobots');
const { publicSiteUrl } = require('../lib/publicSiteUrl');

/** Production URLs in sitemap.xml — never write localhost for static deploy files */
function sitemapSiteUrl() {
  const override = String(process.env.SITEMAP_BASE_URL || '').trim().replace(/\/+$/, '');
  if (override) return override;

  const url = publicSiteUrl();
  if (/localhost|127\.0\.0\.1/i.test(url)) {
    return 'https://www.bazaar-pk.com';
  }
  return url;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is required.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const siteUrl = sitemapSiteUrl();
  const xml = await buildSitemapXml(siteUrl);
  const robots = buildRobotsTxt(siteUrl);

  const publicDir = path.join(__dirname, '../../frontend/public');
  const sitemapPath = path.join(publicDir, 'sitemap.xml');
  const robotsPath = path.join(publicDir, 'robots.txt');

  fs.writeFileSync(sitemapPath, `${xml}\n`, 'utf8');
  fs.writeFileSync(robotsPath, `${robots.trim()}\n`, 'utf8');

  const urlCount = (xml.match(/<url>/g) || []).length;
  console.log(`Wrote ${urlCount} URLs to ${sitemapPath}`);
  console.log(`Wrote robots.txt → ${robotsPath}`);
  console.log(`Site base: ${siteUrl}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
