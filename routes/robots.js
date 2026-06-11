const { buildRobotsTxt } = require('../lib/seoRobots');
const { CACHE_SEO_CONTROL } = require('../lib/staticCacheHeaders');

/**
 * GET /robots.txt — crawl rules + Sitemap URL (see server.js mount).
 */
module.exports = function robotsHandler(req, res) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', CACHE_SEO_CONTROL);
  res.status(200).send(buildRobotsTxt());
};
