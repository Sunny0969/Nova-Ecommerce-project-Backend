const path = require('path');
const fs = require('fs');
const { CACHE_SEO_CONTROL } = require('../lib/staticCacheHeaders');
const { normalizeSiteUrl } = require('../lib/sitemapPaths');

const DEFAULT_ROBOTS = `User-agent: *
Allow: /
Allow: /llms.txt

Disallow: /admin
Disallow: /admin/
Disallow: /staff
Disallow: /staff/
Disallow: /account
Disallow: /account/
Disallow: /orders
Disallow: /checkout
Disallow: /cart
Disallow: /wishlist
Disallow: /login
Disallow: /register
Disallow: /forgot-password
Disallow: /reset-password
Disallow: /verify-email
Disallow: /order-confirmation

Sitemap: {{SITEMAP_URL}}
`;

function loadRobotsText() {
  const candidates = [
    process.env.ROBOTS_TXT_PATH,
    path.join(__dirname, '..', '..', 'frontend', 'public', 'robots.txt'),
    path.join(__dirname, '..', 'public', 'robots.txt')
  ].filter(Boolean);

  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        return fs.readFileSync(file, 'utf8');
      }
    } catch {
      /* try next */
    }
  }

  return DEFAULT_ROBOTS;
}

/**
 * GET /robots.txt
 */
module.exports = function robotsHandler(req, res) {
  const siteUrl = normalizeSiteUrl(process.env.FRONTEND_URL || 'https://www.bazaar-pk.com');
  const sitemapUrl = `${siteUrl}/sitemap.xml`;
  let body = loadRobotsText();

  if (!/^\s*Sitemap:/im.test(body)) {
    body = `${body.trim()}\n\nSitemap: ${sitemapUrl}\n`;
  } else {
    body = body.replace(/^\s*Sitemap:.*$/gim, `Sitemap: ${sitemapUrl}`);
  }

  body = body.replace(/\{\{SITEMAP_URL\}\}/g, sitemapUrl);

  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Cache-Control', CACHE_SEO_CONTROL);
  res.send(body);
};
