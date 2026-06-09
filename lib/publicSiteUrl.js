/**
 * Canonical public storefront origin (no trailing slash).
 * Prefers bazaar-pk.com when FRONTEND_URL lists multiple origins.
 */
function publicSiteUrl() {
  const raw = (process.env.FRONTEND_URL || process.env.SITE_URL || 'https://bazaar-pk.com').trim();
  const urls = raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  const production = urls.find((u) => /bazaar-pk\.com/i.test(u));
  if (production) return production;

  const first = urls[0];
  if (first) return first;

  return 'https://bazaar-pk.com';
}

module.exports = { publicSiteUrl };
