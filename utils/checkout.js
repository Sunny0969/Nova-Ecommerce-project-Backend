const mongoose = require('mongoose');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const { validateCouponForCart } = require('./cartCoupon');
const { getStoreSettings } = require('../services/storeSettings');
const Coupon = require('../models/Coupon');
const { validateCouponForGuestItems } = require('./cartCoupon');
const { computeCartWeightKg, resolveStandardShippingPrice, shouldUseFlatStandardShipping } = require('../lib/shippingWeight');
const { findWeightShippingTier, formatWeightTierRange, hasWeightShippingTiers } = require('../lib/weightShippingTiers');

const ITEMS_POPULATE = {
  path: 'items.product',
  select: 'name price stock slug images category isPublished weight weightKg',
  populate: { path: 'category', select: 'name slug' }
};

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * @param {number} itemsPrice — pre-discount items subtotal (used for free-shipping threshold)
 * @param {string} deliveryOption
 * @param {object} settings — from getStoreSettings()
 * @param {number|null} [cartWeightKg] — total cart weight for weight-based standard shipping
 * @param {Array|null} [cartLines] — cart lines for missing-weight / sub-threshold fallback
 */
function calculateShipping(itemsPrice, deliveryOption, settings, cartWeightKg = null, cartLines = null) {
  const d = deliveryOption || 'standard';
  let shipping = 0;
  if (d === 'express') {
    const rate = Number(settings?.shippingExpress);
    shipping = round2(Number.isFinite(rate) && rate >= 0 ? rate : 499);
  } else if (d === 'nextday') {
    const rate = Number(settings?.shippingNextDay);
    shipping = round2(Number.isFinite(rate) && rate >= 0 ? rate : 599);
  } else if (settings?.weightShippingEnabled !== false) {
    shipping = resolveStandardShippingPrice(cartLines, cartWeightKg, settings);
  } else {
    shipping = round2(Number(settings?.shippingStandard) ?? 299);
  }

  const freeMin = Number(settings?.freeShippingMin);
  const skipFreeShipping =
    d === 'standard' &&
    cartLines &&
    (shouldUseFlatStandardShipping(cartLines, settings) ||
      (settings?.weightShippingEnabled !== false && hasWeightShippingTiers(settings)));
  if (
    !skipFreeShipping &&
    d === 'standard' &&
    Number.isFinite(freeMin) &&
    freeMin > 0 &&
    Number(itemsPrice) >= freeMin
  ) {
    return 0;
  }
  return shipping;
}

/** Tax on merchandise after discount (not on shipping). */
function calculateTaxPrice(subtotalAfterDiscount, settings) {
  const rate = Math.min(1, Math.max(0, Number(settings?.taxRate) || 0));
  return round2(Math.max(0, subtotalAfterDiscount) * rate);
}

/**
 * Preview totals for cart UI / checkout sidebar (must match buildCheckoutSnapshot).
 * @param {number|null} [cartWeightKg]
 * @param {Array|null} [cartLines]
 */
function computeTotalsPreview(itemsPrice, discountAmount, deliveryOption, settings, cartWeightKg = null, cartLines = null) {
  const disc = Math.min(Number(discountAmount) || 0, itemsPrice);
  const subAfterDisc = round2(Math.max(0, itemsPrice - disc));
  const shippingPrice = calculateShipping(itemsPrice, deliveryOption, settings, cartWeightKg, cartLines);
  const taxPrice = calculateTaxPrice(subAfterDisc, settings);
  const totalPrice = round2(Math.max(0, subAfterDisc + shippingPrice + taxPrice));

  let weightShippingTierLabel;
  if (
    (deliveryOption || 'standard') === 'standard' &&
    settings?.weightShippingEnabled !== false &&
    cartWeightKg != null &&
    cartLines &&
    !shouldUseFlatStandardShipping(cartLines, settings)
  ) {
    const tier = findWeightShippingTier(cartWeightKg, settings?.weightShippingTiers);
    if (tier) weightShippingTierLabel = formatWeightTierRange(tier);
  }

  return {
    itemsPrice,
    discountAmount: disc,
    subtotalAfterDiscount: subAfterDisc,
    shippingPrice,
    taxPrice,
    totalPrice,
    cartWeightKg: cartWeightKg != null ? cartWeightKg : undefined,
    weightShippingTierLabel
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
  const cartWeightKg = computeCartWeightKg(cart.items, settings);
  const shippingPrice = calculateShipping(itemsPrice, deliveryOption, settings, cartWeightKg, cart.items);
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

/**
 * Build checkout snapshot from guest cart lines (no server cart / login).
 * @param {Array<{ productId: string, quantity: number, price?: number }>} guestItems
 * @param {string} [deliveryOption]
 * @param {string} [couponCode]
 */
async function buildGuestCheckoutSnapshot(guestItems, deliveryOption = 'standard', couponCode = null) {
  const settings = await getStoreSettings();
  if (!Array.isArray(guestItems) || !guestItems.length) {
    const err = new Error('Cart is empty');
    err.code = 'EMPTY_CART';
    throw err;
  }

  const productIds = guestItems.map((line) => line.productId).filter(Boolean);
  const products = await Product.find({ _id: { $in: productIds } }).lean();
  const byId = Object.fromEntries(products.map((p) => [String(p._id), p]));

  const orderLines = [];
  let itemsPrice = 0;

  for (const line of guestItems) {
    const idStr = String(line.productId || '');
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

  let discountAmount = 0;
  let couponId = null;
  if (couponCode) {
    const guestLinesForCoupon = guestItems.map((line) => {
      const idStr = String(line.productId || '');
      const p = byId[idStr];
      return {
        productId: idStr,
        quantity: Math.floor(Number(line.quantity)),
        price: line.price != null && line.price >= 0 ? Number(line.price) : p ? Number(p.price) : undefined
      };
    });
    const check = await validateCouponForGuestItems(couponCode, guestLinesForCoupon, null);
    if (!check.ok) {
      const err = new Error(check.message || 'Coupon cannot be applied');
      err.code = 'BAD_COUPON';
      throw err;
    }
    discountAmount = check.discountAmount;
    const coupon = await Coupon.findOne({ code: String(couponCode).trim().toUpperCase() }).select('_id').lean();
    couponId = coupon?._id || null;
  }

  const guestLines = guestItems.map((line) => {
    const idStr = String(line.productId || '');
    const p = byId[idStr];
    return { product: p, quantity: Math.floor(Number(line.quantity)) };
  });
  const cartWeightKg = computeCartWeightKg(guestLines, settings);
  const shippingPrice = calculateShipping(itemsPrice, deliveryOption, settings, cartWeightKg, guestLines);
  const subAfterDisc = round2(Math.max(0, itemsPrice - discountAmount));
  const taxPrice = calculateTaxPrice(subAfterDisc, settings);
  const totalPrice = round2(Math.max(0, subAfterDisc + shippingPrice + taxPrice));

  return {
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
  buildGuestCheckoutSnapshot,
  calculateShipping,
  calculateTaxPrice,
  computeTotalsPreview,
  round2,
  computeCartWeightKg
};
