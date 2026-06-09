const { buildRobotsTxt } = require('../lib/seoRobots');

/**
 * GET /robots.txt — crawl rules + Sitemap URL (see server.js mount).
 */
module.exports = function robotsHandler(req, res) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).send(buildRobotsTxt());
};
