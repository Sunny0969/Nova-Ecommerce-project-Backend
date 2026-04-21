/**
 * Wishlist APIs — JWT required (`requireJwtAuth` on `/api/wishlist` in server.js).
 */

const express = require('express');
const Wishlist = require('../models/Wishlist');
const { resolveProductByIdOrSlug } = require('../utils/productResolve');

const router = express.Router();

const POPULATE_PRODUCTS = {
  path: 'products',
  select:
    'name price stock slug images shortDescription description category isPublished',
  populate: { path: 'category', select: 'name slug' }
};

function ok(res, status, payload) {
  res.status(status).json({ success: true, ...payload });
}

function fail(res, status, message, errors) {
  const body = { success: false, message };
  if (errors && Object.keys(errors).length) body.errors = errors;
  res.status(status).json(body);
}

async function getOrCreateWishlist(userId) {
  let doc = await Wishlist.findOne({ user: userId });
  if (!doc) {
    doc = await Wishlist.create({ user: userId, products: [] });
  }
  return doc;
}

async function loadWishlistPopulated(userId) {
  const doc = await getOrCreateWishlist(userId);
  await doc.populate(POPULATE_PRODUCTS);
  return doc;
}

/**
 * Shared toggle logic — productId can be Mongo _id or slug.
 */
async function toggleProductOnWishlist(userId, productIdRaw) {
  const product = await resolveProductByIdOrSlug(String(productIdRaw || '').trim());
  if (!product) {
    const err = new Error('Product not found');
    err.status = 404;
    throw err;
  }
  if (!product.isPublished) {
    const err = new Error('Product is not available');
    err.status = 400;
    throw err;
  }

  const pid = product._id;
  const wishlist = await getOrCreateWishlist(userId);
  const ids = wishlist.products.map((p) => String(p));
  const key = String(pid);
  let action;

  if (ids.includes(key)) {
    wishlist.products = wishlist.products.filter((p) => String(p) !== key);
    action = 'removed';
  } else {
    wishlist.products.push(pid);
    action = 'added';
  }

  await wishlist.save();
  await wishlist.populate(POPULATE_PRODUCTS);

  return { action, wishlist };
}

/**
 * GET /api/wishlist
 */
router.get('/', async (req, res) => {
  try {
    const wishlist = await loadWishlistPopulated(req.authUserId);
    return ok(res, 200, {
      data: {
        wishlist: {
          _id: wishlist._id,
          user: wishlist.user,
          products: wishlist.products,
          createdAt: wishlist.createdAt,
          updatedAt: wishlist.updatedAt
        }
      }
    });
  } catch (error) {
    console.error('Wishlist GET error:', error);
    return fail(res, 500, error.message || 'Failed to load wishlist');
  }
});

/**
 * POST /api/wishlist/toggle — body: { productId } (preferred; avoids proxy/path issues)
 * Must be registered before POST /:productId so "toggle" is not captured as a slug.
 */
router.post('/toggle', async (req, res) => {
  try {
    const raw = req.body?.productId ?? req.body?.product;
    if (raw == null || String(raw).trim() === '') {
      return fail(res, 400, 'productId is required', {
        productId: 'Send JSON { "productId": "<mongo id or slug>" }'
      });
    }
    const { action, wishlist } = await toggleProductOnWishlist(req.authUserId, raw);
    return ok(res, 200, {
      message:
        action === 'added' ? 'Added to wishlist' : 'Removed from wishlist',
      data: {
        action,
        wishlist: {
          _id: wishlist._id,
          user: wishlist.user,
          products: wishlist.products,
          createdAt: wishlist.createdAt,
          updatedAt: wishlist.updatedAt
        }
      }
    });
  } catch (error) {
    const status = error.status || 500;
    if (status === 404) return fail(res, 404, error.message || 'Product not found');
    if (status === 400) return fail(res, 400, error.message || 'Bad request');
    console.error('Wishlist toggle error:', error);
    return fail(res, 500, error.message || 'Failed to update wishlist');
  }
});

/**
 * POST /api/wishlist/:productId — toggle (add if missing, remove if present)
 */
router.post('/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const { action, wishlist } = await toggleProductOnWishlist(
      req.authUserId,
      productId
    );
    return ok(res, 200, {
      message:
        action === 'added' ? 'Added to wishlist' : 'Removed from wishlist',
      data: {
        action,
        wishlist: {
          _id: wishlist._id,
          user: wishlist.user,
          products: wishlist.products,
          createdAt: wishlist.createdAt,
          updatedAt: wishlist.updatedAt
        }
      }
    });
  } catch (error) {
    const status = error.status || 500;
    if (status === 404) return fail(res, 404, error.message || 'Product not found');
    if (status === 400) return fail(res, 400, error.message || 'Bad request');
    console.error('Wishlist toggle error:', error);
    return fail(res, 500, error.message || 'Failed to update wishlist');
  }
});

/**
 * DELETE /api/wishlist — clear all (defined before /:productId for clarity)
 */
router.delete('/', async (req, res) => {
  try {
    const wishlist = await getOrCreateWishlist(req.authUserId);
    wishlist.products = [];
    await wishlist.save();

    return ok(res, 200, {
      message: 'Wishlist cleared',
      data: {
        wishlist: {
          _id: wishlist._id,
          user: wishlist.user,
          products: [],
          createdAt: wishlist.createdAt,
          updatedAt: wishlist.updatedAt
        }
      }
    });
  } catch (error) {
    console.error('Wishlist clear error:', error);
    return fail(res, 500, error.message || 'Failed to clear wishlist');
  }
});

/**
 * DELETE /api/wishlist/:productId
 */
router.delete('/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const product = await resolveProductByIdOrSlug(productId);
    if (!product) {
      return fail(res, 404, 'Product not found');
    }

    const key = String(product._id);
    const wishlist = await getOrCreateWishlist(req.authUserId);
    const before = wishlist.products.length;
    wishlist.products = wishlist.products.filter((p) => String(p) !== key);
    await wishlist.save();
    await wishlist.populate(POPULATE_PRODUCTS);

    const removed = before > wishlist.products.length;

    return ok(res, 200, {
      message: removed ? 'Removed from wishlist' : 'Product was not in wishlist',
      data: {
        removed,
        wishlist: {
          _id: wishlist._id,
          user: wishlist.user,
          products: wishlist.products,
          createdAt: wishlist.createdAt,
          updatedAt: wishlist.updatedAt
        }
      }
    });
  } catch (error) {
    console.error('Wishlist DELETE product error:', error);
    return fail(res, 500, error.message || 'Failed to update wishlist');
  }
});

module.exports = router;
