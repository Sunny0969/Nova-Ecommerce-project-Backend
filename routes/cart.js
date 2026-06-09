/**
 * Cart APIs — all routes require JWT (`requireJwtAuth` on `/api/cart` in server.js).
 */

const express = require('express');
const router = express.Router();
const Coupon = require('../models/Coupon');
const { resolveProductByIdOrSlug } = require('../utils/productResolve');
const {
  getOrCreateUserCart,
  normalizeQuantity
} = require('../utils/cartSync');
const {
  validateCouponForCart,
  lineUnitPrice
} = require('../utils/cartCoupon');
const { getStoreSettings } = require('../services/storeSettings');
const { computeTotalsPreview, computeCartWeightKg } = require('../utils/checkout');

const POPULATE_ITEMS = {
  path: 'items.product',
  select: 'name price stock slug images description shortDescription category isPublished weight weightKg',
  populate: { path: 'category', select: 'name slug' }
};

function ok(res, payload, message, extra = {}) {
  const data = { ...payload, ...extra };
  if (extra.userId != null) data.userId = extra.userId;
  res.json({ success: true, message, data });
}

function fail(res, status, message, errors) {
  const body = { success: false, message };
  if (errors && Object.keys(errors).length) body.errors = errors;
  res.status(status).json(body);
}

async function resolveProductFromBody(body) {
  const ref =
    body.productId != null && body.productId !== ''
      ? body.productId
      : body.product != null
        ? body.product
        : null;
  if (ref == null || ref === '') return null;
  return resolveProductByIdOrSlug(ref);
}

async function loadCartPopulated(userId) {
  const cart = await getOrCreateUserCart(userId);
  await cart.populate([POPULATE_ITEMS, { path: 'coupon' }]);
  return cart;
}

/**
 * Re-validates coupon against current lines; clears coupon if invalid; saves discountAmount.
 */
async function syncCartDiscount(cartDoc) {
  await cartDoc.populate([POPULATE_ITEMS, { path: 'coupon' }]);

  if (!cartDoc.coupon) {
    cartDoc.discountAmount = 0;
    await cartDoc.save();
    return cartDoc;
  }

  const coupon = cartDoc.coupon;
  const result = await validateCouponForCart(coupon, cartDoc.items, cartDoc.user);

  if (!result.ok) {
    cartDoc.coupon = null;
    cartDoc.discountAmount = 0;
  } else {
    cartDoc.discountAmount = result.discountAmount;
  }
  await cartDoc.save();
  await cartDoc.populate([POPULATE_ITEMS, { path: 'coupon' }]);
  return cartDoc;
}

async function formatCartResponse(cartDoc) {
  const items = (cartDoc.items || [])
    .filter((line) => line.product)
    .map((line) => {
      const unit = lineUnitPrice(line);
      const qty = line.quantity || 0;
      return {
        product: line.product,
        quantity: qty,
        price: unit,
        lineTotal: Math.round(unit * qty * 100) / 100
      };
    });

  const totals = cartDoc.calculateTotals();
  const settings = await getStoreSettings();
  const cartWeightKg = computeCartWeightKg(items, settings);
  const pricingPreview = computeTotalsPreview(
    totals.itemsSubtotal,
    totals.discountAmount,
    'standard',
    settings,
    cartWeightKg
  );

  let couponSummary = null;
  if (cartDoc.coupon && typeof cartDoc.coupon === 'object') {
    const c = cartDoc.coupon;
    couponSummary = {
      code: c.code,
      discountType: c.discountType,
      discountValue: c.discountValue
    };
  }

  return {
    items,
    coupon: couponSummary,
    discountAmount: Number(cartDoc.discountAmount) || 0,
    totals: {
      itemsSubtotal: totals.itemsSubtotal,
      discountAmount: totals.discountAmount,
      total: totals.total
    },
    storeSettings: settings,
    pricingPreview
  };
}

/** GET /api/cart */
router.get('/', async (req, res) => {
  try {
    let cartDoc = await loadCartPopulated(req.authUserId);
    cartDoc = await syncCartDiscount(cartDoc);
    ok(res, await formatCartResponse(cartDoc), 'Cart loaded', { userId: req.authUserId });
  } catch (error) {
    console.error('Get cart error:', error);
    fail(res, 500, error.message || 'Failed to fetch cart');
  }
});

/** POST /api/cart/add — body: { productId, quantity? } */
router.post('/add', async (req, res) => {
  try {
    const qty = normalizeQuantity(req.body.quantity, 1);

    const product = await resolveProductFromBody(req.body);
    if (!product) {
      return fail(res, 400, 'Valid productId is required', {
        productId: 'Provide productId (Mongo _id or product slug)'
      });
    }

    if (!product.isPublished) {
      return fail(res, 400, 'Product is not available');
    }

    if (product.stock < qty) {
      return fail(res, 400, 'Not enough stock', {
        stock: `Only ${product.stock} available`
      });
    }

    const productIdStr = String(product._id);
    let cartDoc = await getOrCreateUserCart(req.authUserId);
    const unitPrice = Number(product.price);

    const idx = cartDoc.items.findIndex((i) => String(i.product) === productIdStr);
    if (idx > -1) {
      const nextQty = cartDoc.items[idx].quantity + qty;
      if (product.stock < nextQty) {
        return fail(res, 400, 'Not enough stock', {
          stock: `Only ${product.stock} available`
        });
      }
      cartDoc.items[idx].quantity = nextQty;
      cartDoc.items[idx].price = unitPrice;
    } else {
      cartDoc.items.push({
        product: product._id,
        quantity: qty,
        price: unitPrice
      });
    }
    await cartDoc.save();
    cartDoc = await syncCartDiscount(cartDoc);
    ok(res, await formatCartResponse(cartDoc), 'Item added to cart', {
      userId: req.authUserId
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return fail(
        res,
        400,
        'Invalid cart data',
        Object.fromEntries(
          Object.values(error.errors || {}).map((e) => [e.path || 'field', e.message])
        )
      );
    }
    console.error('Add to cart error:', error);
    fail(res, 500, error.message || 'Failed to add item to cart');
  }
});

/** PUT /api/cart/update — body: { productId, quantity } */
router.put('/update', async (req, res) => {
  try {
    const productDoc = await resolveProductFromBody(req.body);
    if (!productDoc) {
      return fail(res, 400, 'Valid productId is required', {
        productId: 'Provide productId'
      });
    }

    const q = Number(req.body.quantity);
    const refStr = String(productDoc._id);

    let cartDoc = await getOrCreateUserCart(req.authUserId);
    const idx = cartDoc.items.findIndex((i) => String(i.product) === refStr);
    if (idx === -1) {
      return fail(res, 404, 'Item not in cart');
    }

    if (!Number.isInteger(q) || q <= 0) {
      cartDoc.items.splice(idx, 1);
    } else {
      if (productDoc.stock < q) {
        return fail(res, 400, 'Not enough stock', {
          stock: `Only ${productDoc.stock} available`
        });
      }
      cartDoc.items[idx].quantity = q;
      cartDoc.items[idx].price = Number(productDoc.price);
    }

    await cartDoc.save();
    cartDoc = await syncCartDiscount(cartDoc);
    ok(res, await formatCartResponse(cartDoc), 'Cart updated', { userId: req.authUserId });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const o = {};
      for (const e of Object.values(error.errors || {})) {
        o[e.path || 'field'] = e.message;
      }
      return fail(res, 400, 'Invalid cart data', o);
    }
    console.error('Update cart error:', error);
    fail(res, 500, error.message || 'Failed to update cart');
  }
});

/** DELETE /api/cart/remove/:productId */
router.delete('/remove/:productId', async (req, res) => {
  try {
    const productDoc = await resolveProductByIdOrSlug(req.params.productId);
    if (!productDoc) {
      return fail(res, 404, 'Product not found');
    }
    const refStr = String(productDoc._id);

    let cartDoc = await getOrCreateUserCart(req.authUserId);
    cartDoc.items = cartDoc.items.filter((i) => String(i.product) !== refStr);
    await cartDoc.save();
    cartDoc = await syncCartDiscount(cartDoc);
    ok(res, await formatCartResponse(cartDoc), 'Item removed from cart', {
      userId: req.authUserId
    });
  } catch (error) {
    console.error('Remove from cart error:', error);
    fail(res, 500, error.message || 'Failed to remove item from cart');
  }
});

/** DELETE /api/cart/clear */
router.delete('/clear', async (req, res) => {
  try {
    const cartDoc = await getOrCreateUserCart(req.authUserId);
    cartDoc.items = [];
    cartDoc.coupon = null;
    cartDoc.discountAmount = 0;
    await cartDoc.save();
    await cartDoc.populate([POPULATE_ITEMS, { path: 'coupon' }]);
    ok(res, await formatCartResponse(cartDoc), 'Cart cleared', { userId: req.authUserId });
  } catch (error) {
    console.error('Clear cart error:', error);
    fail(res, 500, error.message || 'Failed to clear cart');
  }
});

/** POST /api/cart/coupon — body: { code } */
router.post('/coupon', async (req, res) => {
  try {
    const raw = req.body.code != null ? String(req.body.code).trim() : '';
    if (!raw) {
      return fail(res, 400, 'Coupon code is required', { code: 'Required' });
    }

    const code = raw.toUpperCase();
    const coupon = await Coupon.findOne({ code });

    if (!coupon) {
      return fail(res, 404, 'Invalid coupon code');
    }

    let cartDoc = await loadCartPopulated(req.authUserId);
    if (!cartDoc.items?.length) {
      return fail(res, 400, 'Cart is empty');
    }

    const check = await validateCouponForCart(coupon, cartDoc.items, cartDoc.user);
    if (!check.ok) {
      return fail(res, 400, check.message || 'Coupon cannot be applied');
    }

    cartDoc.coupon = coupon._id;
    cartDoc.discountAmount = check.discountAmount;
    await cartDoc.save();
    cartDoc = await loadCartPopulated(req.authUserId);
    ok(res, await formatCartResponse(cartDoc), 'Coupon applied', { userId: req.authUserId });
  } catch (error) {
    console.error('Apply coupon error:', error);
    fail(res, 500, error.message || 'Failed to apply coupon');
  }
});

/** DELETE /api/cart/coupon */
router.delete('/coupon', async (req, res) => {
  try {
    let cartDoc = await getOrCreateUserCart(req.authUserId);
    cartDoc.coupon = null;
    cartDoc.discountAmount = 0;
    await cartDoc.save();
    cartDoc = await loadCartPopulated(req.authUserId);
    ok(res, await formatCartResponse(cartDoc), 'Coupon removed', { userId: req.authUserId });
  } catch (error) {
    console.error('Remove coupon error:', error);
    fail(res, 500, error.message || 'Failed to remove coupon');
  }
});

module.exports = router;
