/**
 * Writes frontend/public/sitemap.xml for static Hostinger deploys.
 * Run before `npm run build` in frontend, or on a schedule after catalog changes.
 *
 * Usage: node scripts/generateSitemap.js
 * Env: MONGODB_URI, FRONTEND_URL (optional, defaults to https://bazaar-pk.com)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { buildSitemapXml } = require('../lib/buildSitemap');
const { publicSiteUrl } = require('../lib/publicSiteUrl');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is required.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const siteUrl = publicSiteUrl();
  const xml = await buildSitemapXml(siteUrl);

  const outPath = path.join(__dirname, '../../frontend/public/sitemap.xml');
  fs.writeFileSync(outPath, `${xml}\n`, 'utf8');

  const urlCount = (xml.match(/<url>/g) || []).length;
  console.log(`Wrote ${urlCount} URLs to ${outPath}`);
  console.log(`Site base: ${siteUrl}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
