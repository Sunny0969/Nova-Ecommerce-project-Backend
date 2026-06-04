const express = require('express');
const Brand = require('../models/Brand');

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
    const rows = await Brand.find({
      isActive: true,
      isPopular: true,
      'image.url': { $ne: '' }
    })
      .sort({ displayOrder: 1, name: 1 })
      .limit(limit)
      .lean();

    ok(res, rows.map(shapeBrand));
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
    const rows = await Brand.find({
      isActive: true,
      'image.url': { $ne: '' }
    })
      .sort({ displayOrder: 1, name: 1 })
      .lean();

    ok(res, rows.map(shapeBrand));
  } catch (err) {
    console.error('List brands error:', err);
    fail(res, 500, err.message || 'Failed to load brands');
  }
});

module.exports = router;
