const Order = require('../models/Order');
const { formatStoreMoney } = require('./formatMoney');

function lineUnitPrice(line) {
  const p = line.product;
  const fromLine = line.price != null && line.price >= 0 ? line.price : null;
  const fromProduct =
    p && typeof p === 'object' && p.price != null ? Number(p.price) : null;
  const unit = fromLine != null ? fromLine : fromProduct;
  return Number.isFinite(unit) && unit >= 0 ? unit : 0;
}

function fullSubtotal(cartItems) {
  return (cartItems || []).reduce(
    (sum, line) => sum + lineUnitPrice(line) * (line.quantity || 0),
    0
  );
}

/**
 * Subtotal of cart lines that match the coupon scope.
 */
function eligibleSubtotal(cartItems, coupon) {
  const applies = coupon.appliesTo || { type: 'all', categories: [], products: [] };
  const type = applies.type || 'all';
  const catIds = new Set((applies.categories || []).map((id) => String(id)));
  const prodIds = new Set((applies.products || []).map((id) => String(id)));

  let sum = 0;
  for (const line of cartItems || []) {
    const p = line.product;
    if (!p || typeof p !== 'object') continue;
    const pid = String(p._id);
    const cid = String(p.category?._id || p.category || '');

    if (type === 'all') {
      sum += lineUnitPrice(line) * (line.quantity || 0);
    } else if (type === 'product' && prodIds.has(pid)) {
      sum += lineUnitPrice(line) * (line.quantity || 0);
    } else if (type === 'category' && cid && catIds.has(cid)) {
      sum += lineUnitPrice(line) * (line.quantity || 0);
    }
  }
  return sum;
}

function computeDiscountAmount(eligibleSub, coupon) {
  if (eligibleSub <= 0) return 0;
  if (coupon.discountType === 'percentage') {
    const pct = Math.min(100, Math.max(0, Number(coupon.discountValue) || 0));
    return Math.round(eligibleSub * (pct / 100) * 100) / 100;
  }
  const fixed = Math.max(0, Number(coupon.discountValue) || 0);
  return Math.min(fixed, eligibleSub);
}

/**
 * @returns {{ ok: boolean, message?: string, discountAmount?: number }}
 */
async function validateCouponForCart(coupon, cartItems, userId) {
  if (!coupon || !coupon.isActive) {
    return { ok: false, message: 'Coupon is not valid' };
  }
  if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
    return { ok: false, message: 'Coupon has expired' };
  }
  if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
    return { ok: false, message: 'Coupon usage limit reached' };
  }
  if (coupon.perCustomerLimit != null && userId) {
    const usedByUser = await Order.countDocuments({
      user: userId,
      coupon: coupon._id
    });
    if (usedByUser >= coupon.perCustomerLimit) {
      return { ok: false, message: 'You have already used this coupon the maximum times' };
    }
  }

  const eligible = eligibleSubtotal(cartItems, coupon);
  if (eligible <= 0) {
    return { ok: false, message: 'Coupon does not apply to items in your cart' };
  }

  const minAmt = Number(coupon.minOrderAmount) || 0;
  if (eligible < minAmt) {
    return {
      ok: false,
      message: `Minimum order amount of ${formatStoreMoney(minAmt)} not met for this coupon`
    };
  }

  const discountAmount = computeDiscountAmount(eligible, coupon);
  return { ok: true, discountAmount };
}

module.exports = {
  fullSubtotal,
  eligibleSubtotal,
  computeDiscountAmount,
  validateCouponForCart,
  lineUnitPrice
};
