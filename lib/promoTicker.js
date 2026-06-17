/**
 * Build storefront promo ticker lines from active admin coupons + featured offers.
 */
const Coupon = require('../models/Coupon');
const { getStoreSettings } = require('../services/storeSettings');

const FEATURED_OFFERS = [];

function isCouponCurrentlyValid(coupon) {
  if (!coupon?.isActive) return false;
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) return false;
  if (coupon.maxUses != null && Number(coupon.usedCount) >= Number(coupon.maxUses)) return false;
  return true;
}

function formatDiscountLabel(coupon) {
  const value = Number(coupon.discountValue) || 0;
  if (coupon.discountType === 'fixed') {
    return `Rs ${Math.round(value).toLocaleString('en-PK')} off`;
  }
  return `${Math.round(value)}% off`;
}

function formatScopeLabel(coupon) {
  const appliesTo = coupon.appliesTo || {};
  if (appliesTo.type === 'category') {
    const names = (appliesTo.categories || [])
      .map((c) => (c && typeof c === 'object' ? c.name : ''))
      .filter(Boolean);
    if (names.length === 1) return `on ${names[0]}`;
    if (names.length > 1) return `on ${names.slice(0, 2).join(' & ')}`;
    return 'on selected categories';
  }
  if (appliesTo.type === 'product') {
    return 'on selected products';
  }
  return 'storewide';
}

function formatMinOrder(coupon) {
  const min = Number(coupon.minOrderAmount) || 0;
  if (min <= 0) return '';
  return ` · Min. order Rs ${Math.round(min).toLocaleString('en-PK')}`;
}

function formatCouponTickerLine(coupon) {
  const code = String(coupon.code || '').trim().toUpperCase();
  const discount = formatDiscountLabel(coupon);
  const scope = formatScopeLabel(coupon);
  const min = formatMinOrder(coupon);
  return {
    id: `coupon-${coupon._id}`,
    text: `Exclusive voucher · ${discount} ${scope}${min}`,
    code,
    href: '/shop'
  };
}

async function buildPromoTickerPayload() {
  const [coupons, settings] = await Promise.all([
    Coupon.find({ isActive: true })
      .sort({ createdAt: -1 })
      .limit(12)
      .populate({ path: 'appliesTo.categories', select: 'name slug' })
      .lean(),
    getStoreSettings()
  ]);

  const validCoupons = coupons.filter(isCouponCurrentlyValid).slice(0, 6);
  const couponItems = validCoupons.map(formatCouponTickerLine);

  const freeMin = Number(settings?.freeShippingMin);
  const freeDeliveryItem =
    Number.isFinite(freeMin) && freeMin > 0
      ? {
          id: 'free-delivery',
          text: `Free standard delivery on orders above Rs ${Math.round(freeMin).toLocaleString('en-PK')}`,
          href: '/shop'
        }
      : null;

  const items = [
    ...FEATURED_OFFERS,
    ...couponItems,
    ...(freeDeliveryItem ? [freeDeliveryItem] : [])
  ];

  return { items };
}

module.exports = {
  FEATURED_OFFERS,
  buildPromoTickerPayload,
  formatCouponTickerLine
};
