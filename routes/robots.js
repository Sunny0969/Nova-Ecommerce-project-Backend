const { publicSiteUrl } = require('../lib/publicSiteUrl');

/**
 * GET /robots.txt — crawl rules + Sitemap URL (see server.js mount).
 */
module.exports = function robotsHandler(req, res) {
  const base = publicSiteUrl();
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin/',
    'Disallow: /account/',
    'Disallow: /cart',
    'Disallow: /checkout',
    'Disallow: /api/',
    '',
    `Sitemap: ${base}/sitemap.xml`,
    ''
  ].join('\n');

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).send(body);
};
