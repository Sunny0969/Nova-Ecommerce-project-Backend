const mongoose = require('mongoose');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const { validateCouponForCart } = require('./cartCoupon');
const { getStoreSettings } = require('../services/storeSettings');

const ITEMS_POPULATE = {
  path: 'items.product',
  select: 'name price stock slug images category isPublished',
  populate: { path: 'category', select: 'name slug' }
};

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * @param {number} itemsPrice — pre-discount items subtotal (used for free-shipping threshold)
 * @param {string} deliveryOption
 * @param {object} settings — from getStoreSettings()
 */
function calculateShipping(itemsPrice, deliveryOption, settings) {
  const threshold = Number(settings?.freeShippingMin);
  const t = Number.isFinite(threshold) && threshold >= 0 ? threshold : 50;
  const d = deliveryOption || 'standard';
  if (d === 'express') {
    if (itemsPrice >= t) return 0;
    return round2(Number(settings?.shippingExpress) ?? 5.99);
  }
  if (d === 'nextday') {
    if (itemsPrice >= t) return 0;
    return round2(Number(settings?.shippingNextDay) ?? 9.99);
  }
  return round2(Number(settings?.shippingStandard) ?? 299);
}

/** Tax on merchandise after discount (not on shipping). */
function calculateTaxPrice(subtotalAfterDiscount, settings) {
  const rate = Math.min(1, Math.max(0, Number(settings?.taxRate) || 0));
  return round2(Math.max(0, subtotalAfterDiscount) * rate);
}

/**
 * Preview totals for cart UI / checkout sidebar (must match buildCheckoutSnapshot).
 */
function computeTotalsPreview(itemsPrice, discountAmount, deliveryOption, settings) {
  const disc = Math.min(Number(discountAmount) || 0, itemsPrice);
  const subAfterDisc = round2(Math.max(0, itemsPrice - disc));
  const shippingPrice = calculateShipping(itemsPrice, deliveryOption, settings);
  const taxPrice = calculateTaxPrice(subAfterDisc, settings);
  const totalPrice = round2(Math.max(0, subAfterDisc + shippingPrice + taxPrice));
  return {
    itemsPrice,
    discountAmount: disc,
    subtotalAfterDiscount: subAfterDisc,
    shippingPrice,
    taxPrice,
    totalPrice
  };
}

function productImageUrl(p) {
  if (p?.images?.length && p.images[0]?.url) return p.images[0].url;
  return '';
}

/**
 * Loads cart, syncs coupon discount, validates stock, builds order lines and totals.
 * @returns {Promise<{
 *   cart: import('mongoose').Document,
 *   orderLines: object[],
 *   itemsPrice: number,
 *   taxPrice: number,
 *   shippingPrice: number,
 *   discountAmount: number,
 *   totalPrice: number,
 *   couponId: import('mongoose').Types.ObjectId | null
 * }>}
 */
async function buildCheckoutSnapshot(userId, deliveryOption = 'standard') {
  const settings = await getStoreSettings();
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const cart = await Cart.findOne({ user: userObjectId });
  if (!cart?.items?.length) {
    const err = new Error('Cart is empty');
    err.code = 'EMPTY_CART';
    throw err;
  }

  await cart.populate([ITEMS_POPULATE, { path: 'coupon' }]);

  if (cart.coupon) {
    const v = await validateCouponForCart(cart.coupon, cart.items, cart.user);
    if (!v.ok) {
      cart.coupon = null;
      cart.discountAmount = 0;
    } else {
      cart.discountAmount = v.discountAmount;
    }
  } else {
    cart.discountAmount = 0;
  }

  const productIds = cart.items.map((i) =>
    i.product?._id ? i.product._id : i.product
  );
  const products = await Product.find({ _id: { $in: productIds } }).lean();
  const byId = Object.fromEntries(products.map((p) => [String(p._id), p]));

  const orderLines = [];
  let itemsPrice = 0;

  for (const line of cart.items) {
    const idStr = String(
      line.product != null && line.product._id != null
        ? line.product._id
        : line.product
    );
    const p = byId[idStr];
    if (!p || !p.isPublished) {
      const err = new Error(`Product no longer available: ${idStr}`);
      err.code = 'PRODUCT_GONE';
      throw err;
    }

    const qty = Math.floor(Number(line.quantity));
    if (!Number.isInteger(qty) || qty < 1) {
      const err = new Error('Invalid quantity in cart');
      err.code = 'BAD_QTY';
      throw err;
    }

    if (p.stock < qty) {
      const err = new Error(`Insufficient stock for ${p.name}`);
      err.code = 'NO_STOCK';
      err.details = { available: p.stock, requested: qty };
      throw err;
    }

    const linePrice =
      line.price != null && line.price >= 0 ? Number(line.price) : Number(p.price);
    if (!Number.isFinite(linePrice) || linePrice < 0) {
      const err = new Error('Invalid product price');
      err.code = 'BAD_PRICE';
      throw err;
    }

    itemsPrice += linePrice * qty;
    orderLines.push({
      product: p._id,
      quantity: qty,
      name: p.name,
      price: linePrice,
      image: productImageUrl(p)
    });
  }

  const totals = cart.calculateTotals();
  const discountAmount = Number(totals.discountAmount) || 0;
  const shippingPrice = calculateShipping(itemsPrice, deliveryOption, settings);
  const subAfterDisc = round2(Math.max(0, itemsPrice - discountAmount));
  const taxPrice = calculateTaxPrice(subAfterDisc, settings);
  const totalPrice = round2(Math.max(0, subAfterDisc + shippingPrice + taxPrice));

  const couponId = cart.coupon ? cart.coupon._id : null;

  return {
    cart,
    orderLines,
    itemsPrice,
    taxPrice,
    shippingPrice,
    discountAmount,
    totalPrice,
    couponId
  };
}

module.exports = {
  buildCheckoutSnapshot,
  calculateShipping,
  calculateTaxPrice,
  computeTotalsPreview,
  round2
};
