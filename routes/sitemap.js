const { buildSitemapXml } = require('../lib/buildSitemap');

/**
 * GET /sitemap.xml — dynamic sitemap for the SPA (see server.js mount).
 */
module.exports = async function sitemapHandler(req, res) {
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  try {
    const xml = await buildSitemapXml();
    res.status(200).send(xml);
  } catch (err) {
    console.error('[sitemap]', err.message);
    res.status(500).setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send('Sitemap temporarily unavailable.');
  }
};
