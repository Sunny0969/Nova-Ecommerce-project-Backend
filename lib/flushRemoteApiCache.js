/**
 * Clear in-memory cache on the live Railway API (if CACHE_FLUSH_SECRET is set).
 */
async function flushRemoteApiCache() {
  const secret = String(process.env.CACHE_FLUSH_SECRET || '').trim();
  if (!secret) {
    console.log('[cache] Skip remote flush — CACHE_FLUSH_SECRET not set in .env');
    return false;
  }

  const apiBase = String(
    process.env.PUBLIC_API_URL ||
      process.env.REACT_APP_API_URL ||
      'https://nova-ecommerce-project-backend-production.up.railway.app'
  ).replace(/\/+$/, '');

  try {
    const res = await fetch(`${apiBase}/api/internal/cache/flush`, {
      method: 'POST',
      headers: { 'X-Cache-Flush-Secret': secret }
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      console.log('[cache] Production API cache cleared');
      return true;
    }
    console.warn('[cache] Remote flush failed:', body.message || res.status);
    return false;
  } catch (err) {
    console.warn('[cache] Remote flush error:', err.message);
    return false;
  }
}

module.exports = { flushRemoteApiCache };
