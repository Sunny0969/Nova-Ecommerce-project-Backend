const { publicSiteUrl } = require('./publicSiteUrl');

function buildRobotsTxt(siteUrl = publicSiteUrl()) {
  const base = String(siteUrl || 'https://bazaar-pk.com').replace(/\/+$/, '');

  return `User-agent: *
Allow: /

Disallow: /staff
Disallow: /staff/
Disallow: /account
Disallow: /account/
Disallow: /orders
Disallow: /checkout
Disallow: /cart
Disallow: /login
Disallow: /register
Disallow: /forgot-password
Disallow: /reset-password

Sitemap: ${base}/sitemap.xml
`;
}

module.exports = { buildRobotsTxt };
