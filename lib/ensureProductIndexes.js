const Product = require('../models/Product');

/** Compound indexes safe to sync via Mongoose (Atlas apiStrict blocks text index API). */
const COMPOUND_INDEX_SPECS = [
  [{ category: 1, isPublished: 1, createdAt: -1 }, { name: 'category_1_isPublished_1_createdAt_-1' }],
  [{ category: 1, isPublished: 1, price: 1 }, { name: 'category_1_isPublished_1_price_1' }],
  [{ category: 1, name: 1 }, { name: 'category_1_name_1' }],
  [{ isPublished: 1, createdAt: -1 }, { name: 'isPublished_1_createdAt_-1' }],
  [{ isPublished: 1, stock: 1, createdAt: -1 }, { name: 'isPublished_1_stock_1_createdAt_-1' }]
];

/**
 * Sync Product indexes at startup (idempotent).
 * Text index remains in schema for local/dev; Atlas apiStrict clusters skip text index creation.
 */
async function ensureProductIndexes() {
  const col = Product.collection;
  const results = [];

  for (const [keys, options] of COMPOUND_INDEX_SPECS) {
    try {
      const name = await col.createIndex(keys, { background: true, ...options });
      results.push(name);
    } catch (err) {
      if (err.code !== 85 && err.code !== 86) {
        console.warn('[indexes] compound index skipped:', options.name, err.message);
      }
    }
  }

  try {
    await Product.createIndexes();
  } catch (err) {
    if (err.code === 323 || err.codeName === 'APIStrictError') {
      console.warn('[indexes] Text index skipped (Atlas apiStrict). Compound indexes synced.');
    } else {
      throw err;
    }
  }

  return col.indexes();
}

module.exports = { ensureProductIndexes, COMPOUND_INDEX_SPECS };
