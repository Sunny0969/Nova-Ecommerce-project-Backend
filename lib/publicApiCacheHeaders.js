const { DEFAULT_TTL, isCacheEnabled } = require('./apiCache');

/** Short browser cache for API responses also served from in-memory cache. */
const PUBLIC_API_CACHE_CONTROL = `public, max-age=${Math.min(DEFAULT_TTL, 300)}, stale-while-revalidate=60`;

const DEV_NO_CACHE = 'no-store, no-cache, must-revalidate, proxy-revalidate';

function setPublicApiCacheHeaders(res, { hit = false } = {}) {
  if (!isCacheEnabled()) {
    res.set('Cache-Control', DEV_NO_CACHE);
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('X-Cache', 'DISABLED');
    return;
  }

  res.set('Cache-Control', PUBLIC_API_CACHE_CONTROL);
  if (hit) {
    res.set('X-Cache', 'HIT');
  } else {
    res.set('X-Cache', 'MISS');
  }
}

module.exports = { PUBLIC_API_CACHE_CONTROL, setPublicApiCacheHeaders };
