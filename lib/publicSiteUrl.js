/**
 * Canonical public storefront origin (no trailing slash).
 * Prefers https://www.bazaar-pk.com when FRONTEND_URL lists multiple origins.
 */
function publicSiteUrl() {
  const raw = (process.env.FRONTEND_URL || process.env.SITE_URL || 'https://www.bazaar-pk.com').trim();
  const urls = raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  const wwwProduction = urls.find((u) => /www\.bazaar-pk\.com/i.test(u));
  if (wwwProduction) return wwwProduction;

  const production = urls.find((u) => /bazaar-pk\.com/i.test(u));
  if (production) {
    return production.replace(/^(https?:\/\/)bazaar-pk\.com/i, '$1www.bazaar-pk.com');
  }

  const first = urls[0];
  if (first) return first;

  return 'https://www.bazaar-pk.com';
}

module.exports = { publicSiteUrl };
