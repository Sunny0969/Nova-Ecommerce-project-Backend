/**
 * Canonical public origin for storefront URLs (sitemap loc, robots Sitemap).
 * Prefer FRONTEND_URL; SITE_URL as fallback. No trailing slash.
 */
function publicSiteUrl() {
  const raw = (process.env.FRONTEND_URL || process.env.SITE_URL || 'http://localhost:3000').trim();
  const base = raw.replace(/\/+$/, '');
  return base || 'http://localhost:3000';
}

module.exports = { publicSiteUrl };
