const express = require('express');
const Category = require('../models/Category');
const { buildPublicSubcategoryTree } = require('../lib/shopSubcategories');
const { setPublicApiCacheHeaders } = require('../lib/publicApiCacheHeaders');
const { getOrSet, CACHE_KEYS } = require('../lib/apiCache');

const router = express.Router();

function ok(res, data, extra = {}) {
  res.status(200).json({ success: true, data, ...extra });
}

function fail(res, status, message) {
  res.status(status).json({ success: false, message });
}

/**
 * GET /api/subcategories?category=clothing
 */
router.get('/', async (req, res) => {
  try {
    const categorySlug = String(req.query.category || '')
      .trim()
      .toLowerCase();
    if (!categorySlug) {
      return fail(res, 400, 'category query is required');
    }

    const cat = await Category.findOne({ slug: categorySlug, isActive: true }).select('_id slug name').lean();
    if (!cat) {
      return ok(res, { category: null, genders: [] });
    }

    const cacheKey = CACHE_KEYS.subcategoriesTree(categorySlug);
    const { value: genders, hit } = await getOrSet(cacheKey, () => buildPublicSubcategoryTree(cat._id));

    setPublicApiCacheHeaders(res, { hit });
    ok(res, {
      category: { _id: cat._id, slug: cat.slug, name: cat.name },
      genders
    });
  } catch (err) {
    console.error('List subcategories error:', err);
    fail(res, 500, err.message || 'Failed to load subcategories');
  }
});

module.exports = router;
