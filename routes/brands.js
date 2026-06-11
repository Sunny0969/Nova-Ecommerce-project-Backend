const express = require('express');
const Brand = require('../models/Brand');
const { isBlockedBrand } = require('../lib/brandFilters');
const { getOrSet, CACHE_KEYS } = require('../lib/apiCache');
const { setPublicApiCacheHeaders } = require('../lib/publicApiCacheHeaders');

const router = express.Router();

function ok(res, data) {
  res.json({ success: true, data });
}

function fail(res, status, message) {
  res.status(status).json({ success: false, message });
}

function shapeBrand(doc) {
  return {
    _id: doc._id,
    name: doc.name,
    slug: doc.slug,
    imageUrl: doc.image?.url || '',
    isPopular: Boolean(doc.isPopular)
  };
}

/**
 * GET /api/brands/popular
 */
router.get('/popular', async (req, res) => {
  try {
    const limit = Math.min(30, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const cacheKey = CACHE_KEYS.brandsPopular(limit);
    const { value: rows, hit } = await getOrSet(cacheKey, async () => {
      const docs = await Brand.find({
        isActive: true,
        isPopular: true,
        'image.url': { $ne: '' }
      })
        .sort({ displayOrder: 1, name: 1 })
        .limit(limit)
        .lean();
      return docs.map(shapeBrand).filter((b) => !isBlockedBrand(b));
    });

    setPublicApiCacheHeaders(res, { hit });
    ok(res, rows);
  } catch (err) {
    console.error('Popular brands error:', err);
    fail(res, 500, err.message || 'Failed to load popular brands');
  }
});

/**
 * GET /api/brands — all active brands (brands page grid)
 */
router.get('/', async (req, res) => {
  try {
    const { value: rows, hit } = await getOrSet(CACHE_KEYS.BRANDS_ALL, async () => {
      const docs = await Brand.find({
        isActive: true,
        'image.url': { $ne: '' }
      })
        .sort({ displayOrder: 1, name: 1 })
        .lean();
      return docs.map(shapeBrand).filter((b) => !isBlockedBrand(b));
    });

    setPublicApiCacheHeaders(res, { hit });
    ok(res, rows);
  } catch (err) {
    console.error('List brands error:', err);
    fail(res, 500, err.message || 'Failed to load brands');
  }
});

module.exports = router;
