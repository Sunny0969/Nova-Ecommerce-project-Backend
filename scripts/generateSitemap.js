/**
 * Generate static sitemap.xml from MongoDB (run on server or locally with MONGODB_URI).
 * Usage: node backend/scripts/generateSitemap.js [--out=path/to/sitemap.xml]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const {
  collectSitemapEntriesFromDb,
  renderSitemapXml,
  renderSitemapIndexXml,
  buildSitemapChunks,
  buildSitemapIndexEntries,
  MAX_URLS_PER_SITEMAP
} = require('../lib/sitemapBuilder');
const { normalizeSiteUrl } = require('../lib/sitemapPaths');

function parseOutArg() {
  const arg = process.argv.find((a) => a.startsWith('--out='));
  if (arg) return path.resolve(arg.split('=').slice(1).join('='));
  return null;
}

function defaultOutputs() {
  const root = path.join(__dirname, '..', '..');
  return [
    path.join(root, 'frontend', 'public', 'sitemap.xml'),
    path.join(root, 'frontend', 'build', 'sitemap.xml')
  ];
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('[sitemap] Missing MONGODB_URI');
    process.exit(1);
  }

  const siteUrl = normalizeSiteUrl(process.env.FRONTEND_URL || process.env.PRERENDER_SITE_URL);
  await mongoose.connect(uri);

  const entries = await collectSitemapEntriesFromDb(siteUrl);
  const outArg = parseOutArg();
  const outputs = outArg ? [outArg] : defaultOutputs();

  if (entries.length <= MAX_URLS_PER_SITEMAP) {
    const xml = renderSitemapXml(entries);
    for (const file of outputs) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, xml, 'utf8');
      console.log(`[sitemap] Wrote ${entries.length} URLs → ${file}`);
    }
  } else {
    const chunks = buildSitemapChunks(siteUrl, entries);
    const indexXml = renderSitemapIndexXml(
      buildSitemapIndexEntries(
        siteUrl,
        chunks.map((c) => c.filename)
      )
    );

    for (const file of outputs) {
      const dir = path.dirname(file);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'sitemap.xml'), indexXml, 'utf8');
      for (const chunk of chunks) {
        fs.writeFileSync(path.join(dir, chunk.filename), renderSitemapXml(chunk.entries), 'utf8');
      }
      console.log(
        `[sitemap] Wrote index + ${chunks.length} chunk(s), ${entries.length} URLs → ${dir}`
      );
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
