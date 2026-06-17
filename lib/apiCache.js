const NodeCache = require('node-cache');

/** Default 5 minutes — override with CACHE_TTL_SECONDS in .env */
const DEFAULT_TTL = Number(process.env.CACHE_TTL_SECONDS) || 300;

/**
 * API cache — ON in production only.
 * Local dev: disabled so DB/code changes show immediately without restart.
 * Deploy par wapas chalu: NODE_ENV=production (Railway default) ya CACHE_ENABLED=true
 */
const enabled =
  process.env.NODE_ENV === 'production' && String(process.env.CACHE_ENABLED || 'true') !== 'false';

if (!enabled) {
  console.log('[Cache] API in-memory cache OFF (local development)');
}

const store = new NodeCache({
  stdTTL: DEFAULT_TTL,
  checkperiod: 120,
  useClones: true
});

const CACHE_KEYS = {
  CATEGORIES_LIST: 'categories:list',
  categorySlug: (slug) => `categories:slug:${slug}`,
  STORE_SETTINGS: 'store-settings',
  PUBLIC_HOME_STATS: 'public:home-stats',
  PUBLIC_PROMO_TICKER: 'public:promo-ticker',
  BRANDS_ALL: 'brands:all',
  brandsPopular: (limit) => `brands:popular:${limit}`,
  PRODUCTS_FEATURED: 'products:featured',
  productsFlashSale: (limit) => `products:flash-sale:${limit}`,
  homeCategorySales: (catLimit, prodLimit) =>
    `products:home-category-sales:${catLimit}:${prodLimit}`,
  subcategoriesTree: (categorySlug) => `subcategories:tree:${categorySlug}`
};

/**
 * Read-through cache: returns cached value or runs `fetchFn` and stores result.
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} fetchFn
 * @param {number} [ttlSeconds]
 * @returns {Promise<{ value: T, hit: boolean }>}
 */
async function getOrSet(key, fetchFn, ttlSeconds = DEFAULT_TTL) {
  if (!enabled) {
    return { value: await fetchFn(), hit: false };
  }

  const cached = store.get(key);
  if (cached !== undefined) {
    return { value: cached, hit: true };
  }

  const value = await fetchFn();
  store.set(key, value, ttlSeconds);
  return { value, hit: false };
}

function del(key) {
  if (!enabled) return 0;
  return store.del(key);
}

function delByPrefix(prefix) {
  if (!enabled) return 0;
  const keys = store.keys().filter((k) => k.startsWith(prefix));
  if (!keys.length) return 0;
  return store.del(keys);
}

function flushAll() {
  if (!enabled) return;
  store.flushAll();
}

function stats() {
  return store.getStats();
}

module.exports = {
  DEFAULT_TTL,
  CACHE_KEYS,
  getOrSet,
  del,
  delByPrefix,
  flushAll,
  stats,
  isCacheEnabled: () => enabled
};
