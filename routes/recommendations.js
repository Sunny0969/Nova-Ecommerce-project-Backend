const express = require('express');
const mongoose = require('mongoose');
const { attachJwtUserSilent } = require('../middleware/jwtAuth');
const {
  loadProductsByIdsOrdered,
  homepageRecommendations,
  similarProducts,
  frequentlyBoughtTogether,
  trendingRecommendations,
  recentlyViewed
} = require('../services/recommendations');

const router = express.Router();

function ok(res, data, status = 200, extra = {}) {
  res.status(status).json({ success: true, data, ...extra });
}

function fail(res, status, message, errors) {
  const body = { success: false, message };
  if (errors && Object.keys(errors).length) body.errors = errors;
  res.status(status).json(body);
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function parseLimit(v, d) {
  const n = parseInt(v, 10);
  if (!Number.isInteger(n) || n < 1) return d;
  return Math.min(30, n);
}

function getIdentity(req) {
  const qSid = req.query.sessionId != null ? String(req.query.sessionId).trim() : '';
  const headerSid = req.headers['x-session-id'] ? String(req.headers['x-session-id']).trim() : '';
  const sessionId = qSid || headerSid;
  const userId = req.authUserId && isValidObjectId(req.authUserId) ? String(req.authUserId) : null;
  return { userId, sessionId };
}

/**
 * GET /api/recommendations/homepage?sessionId=
 */
router.get('/homepage', attachJwtUserSilent, async (req, res) => {
  try {
    const { userId, sessionId } = getIdentity(req);
    const limit = parseLimit(req.query.limit, 12);
    const ids = await homepageRecommendations({ userId, sessionId, limit });
    const products = await loadProductsByIdsOrdered(ids);
    ok(res, { products });
  } catch (error) {
    console.error('homepage recommendations error:', error);
    fail(res, 500, error.message || 'Failed to load recommendations');
  }
});

/**
 * GET /api/recommendations/similar/:productId
 */
router.get('/similar/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    if (!isValidObjectId(productId)) return fail(res, 400, 'Invalid productId');
    const limit = parseLimit(req.query.limit, 10);
    const ids = await similarProducts({ productId, limit });
    const products = await loadProductsByIdsOrdered(ids);
    ok(res, { products });
  } catch (error) {
    console.error('similar recommendations error:', error);
    fail(res, 500, error.message || 'Failed to load similar products');
  }
});

/**
 * GET /api/recommendations/frequently-bought/:productId
 */
router.get('/frequently-bought/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    if (!isValidObjectId(productId)) return fail(res, 400, 'Invalid productId');
    const limit = parseLimit(req.query.limit, 10);
    const ids = await frequentlyBoughtTogether({ productId, limit });
    const products = await loadProductsByIdsOrdered(ids);
    ok(res, { products });
  } catch (error) {
    console.error('frequently-bought error:', error);
    fail(res, 500, error.message || 'Failed to load frequently bought together');
  }
});

/**
 * GET /api/recommendations/trending
 */
router.get('/trending', async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 12);
    const ids = await trendingRecommendations({ limit });
    const products = await loadProductsByIdsOrdered(ids);
    ok(res, { products });
  } catch (error) {
    console.error('trending recommendations error:', error);
    fail(res, 500, error.message || 'Failed to load trending products');
  }
});

/**
 * GET /api/recommendations/recently-viewed?sessionId=
 */
router.get('/recently-viewed', attachJwtUserSilent, async (req, res) => {
  try {
    const { userId, sessionId } = getIdentity(req);
    const limit = parseLimit(req.query.limit, 12);
    const ids = await recentlyViewed({ userId, sessionId, limit });
    const products = await loadProductsByIdsOrdered(ids);
    ok(res, { products });
  } catch (error) {
    console.error('recently-viewed error:', error);
    fail(res, 500, error.message || 'Failed to load recently viewed');
  }
});

module.exports = router;

