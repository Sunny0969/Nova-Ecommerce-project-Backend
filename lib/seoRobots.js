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

Sitemap: ${base}/sitemap.xml
`;
}

module.exports = { buildRobotsTxt };
