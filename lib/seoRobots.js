const { publicSiteUrl } = require('./publicSiteUrl');

function buildRobotsTxt(siteUrl = publicSiteUrl()) {
  const base = String(siteUrl || 'https://www.bazaar-pk.com').replace(/\/+$/, '');

  return `User-agent: *
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

# Do NOT Disallow /static/js/ or /static/css/ — Google needs them to render SPA routes
# (product detail, blog, etc.). Prerendered catalog pages include inline CSS, but other
# routes still require bundled JS/CSS for "View Crawled Page" / Mobile-Friendly Test.
# Crawl-budget savings come from Cache-Control: immutable (1y) on hashed chunks instead.

Sitemap: ${base}/sitemap.xml
`;
}

module.exports = { buildRobotsTxt };
