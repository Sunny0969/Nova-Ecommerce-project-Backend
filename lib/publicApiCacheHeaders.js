const { DEFAULT_TTL } = require('./apiCache');

/** Short browser cache for API responses also served from in-memory cache. */
const PUBLIC_API_CACHE_CONTROL = `public, max-age=${Math.min(DEFAULT_TTL, 300)}, stale-while-revalidate=60`;

function setPublicApiCacheHeaders(res, { hit = false } = {}) {
  res.set('Cache-Control', PUBLIC_API_CACHE_CONTROL);
  if (hit) {
    res.set('X-Cache', 'HIT');
  } else {
    res.set('X-Cache', 'MISS');
  }
}

module.exports = { PUBLIC_API_CACHE_CONTROL, setPublicApiCacheHeaders };
