const { CACHE_SEO_CONTROL } = require('../lib/staticCacheHeaders');
const {
  collectSitemapEntriesFromDb,
  renderSitemapXml,
  renderSitemapIndexXml,
  buildSitemapChunks,
  buildSitemapIndexEntries,
  MAX_URLS_PER_SITEMAP
} = require('../lib/sitemapBuilder');
const { normalizeSiteUrl } = require('../lib/sitemapPaths');

/**
 * GET /sitemap.xml — dynamic sitemap for Railway API host (and optional static mirror).
 */
module.exports = async function sitemapHandler(req, res) {
  try {
    const siteUrl = normalizeSiteUrl(process.env.FRONTEND_URL || 'https://www.bazaar-pk.com');
    const entries = await collectSitemapEntriesFromDb(siteUrl);

    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', CACHE_SEO_CONTROL);

    if (entries.length <= MAX_URLS_PER_SITEMAP) {
      return res.send(renderSitemapXml(entries));
    }

    const chunks = buildSitemapChunks(siteUrl, entries);
    const indexEntries = buildSitemapIndexEntries(
      siteUrl,
      chunks.map((c) => c.filename)
    );
    return res.send(renderSitemapIndexXml(indexEntries));
  } catch (error) {
    console.error('[sitemap] Failed to generate sitemap:', error);
    res.status(500).type('text/plain').send('Sitemap generation failed');
  }
};
