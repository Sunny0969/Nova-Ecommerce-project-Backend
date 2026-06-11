const { CACHE_KEYS, del, delByPrefix } = require('./apiCache');

/** Product listing / homepage promo data (prices, counts, sales). */
function invalidateProductListingsCache() {
  del(CACHE_KEYS.PUBLIC_HOME_STATS);
  del(CACHE_KEYS.PRODUCTS_FEATURED);
  delByPrefix('products:flash-sale:');
  delByPrefix('products:home-category-sales:');
}

/** Category grid + brand grids (product counts / catalog shape). */
function invalidateCatalogCache() {
  del(CACHE_KEYS.CATEGORIES_LIST);
  delByPrefix('categories:slug:');
  del(CACHE_KEYS.BRANDS_ALL);
  delByPrefix('brands:popular:');
  invalidateProductListingsCache();
}

function invalidateStoreSettingsCache() {
  del(CACHE_KEYS.STORE_SETTINGS);
  del(CACHE_KEYS.PUBLIC_HOME_STATS);
}

module.exports = {
  invalidateCatalogCache,
  invalidateProductListingsCache,
  invalidateStoreSettingsCache
};
