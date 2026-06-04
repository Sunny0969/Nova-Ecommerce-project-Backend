/**
 * Public storefront metrics — no auth required.
 */
const express = require('express');
const Product = require('../models/Product');
const User = require('../models/User');
const Category = require('../models/Category');
const Coupon = require('../models/Coupon');
const { getStoreSettings } = require('../services/storeSettings');

const router = express.Router();

function ok(res, data) {
  res.json({ success: true, data });
}

function maxProductDiscountPercent(products) {
  let maxPct = 0;
  for (const p of products) {
    const compare = Number(p.comparePrice);
    const price = Number(p.price);
    if (!Number.isFinite(compare) || !Number.isFinite(price) || compare <= price || compare <= 0) {
      continue;
    }
    const pct = Math.round(((compare - price) / compare) * 100);
    if (pct > maxPct) maxPct = pct;
  }
  return maxPct > 0 ? maxPct : null;
}

async function buildPromoHighlight(settings) {
  const now = new Date();
  const couponQuery = {
    isActive: true,
    $and: [
      { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
      {
        $or: [
          { maxUses: null },
          { $expr: { $lt: ['$usedCount', '$maxUses'] } }
        ]
      }
    ]
  };

  const [coupon, saleProducts] = await Promise.all([
    Coupon.findOne(couponQuery).sort({ discountValue: -1 }).lean(),
    Product.find({
      isPublished: true,
      comparePrice: { $gt: 0 }
    })
      .select('price comparePrice')
      .limit(200)
      .lean()
  ]);

  const freeMin = Number(settings?.freeShippingMin);
  const freeDeliveryNote =
    Number.isFinite(freeMin) && freeMin > 0
      ? `Free delivery on orders above Rs ${Math.round(freeMin).toLocaleString('en-PK')}`
      : null;

  const productPct = maxProductDiscountPercent(saleProducts);
  let pct = null;
  let titlePrefix = 'Sale';

  if (coupon?.discountType === 'percentage' && Number(coupon.discountValue) > 0) {
    pct = Math.min(100, Math.round(Number(coupon.discountValue)));
    titlePrefix = coupon.code ? String(coupon.code).trim() : 'Sale';
  } else if (productPct) {
    pct = productPct;
  }

  if (pct == null) return null;

  return {
    title: `${titlePrefix} — Up to ${pct}% Off`,
    subtitle: freeDeliveryNote
      ? `Limited time • ${freeDeliveryNote}`
      : 'Limited time • Best prices on Rozana'
  };
}

/**
 * GET /api/public/home-stats
 * Returns counts for homepage hero; null values mean "Coming Soon" on the client.
 */
router.get('/home-stats', async (req, res) => {
  try {
    const [productCount, customerCount, categoryCount, settings] = await Promise.all([
      Product.countDocuments({ isPublished: true }),
      User.countDocuments({ role: 'customer', isActive: { $ne: false } }),
      Category.countDocuments({ isActive: { $ne: false } }),
      getStoreSettings()
    ]);

    const freeMin = Number(settings?.freeShippingMin);
    const deliveryLabel =
      Number.isFinite(freeMin) && freeMin > 0
        ? `Free delivery over Rs ${Math.round(freeMin).toLocaleString('en-PK')}`
        : null;

    const promo = await buildPromoHighlight(settings);

    return ok(res, {
      productCount: productCount > 0 ? productCount : null,
      customerCount: customerCount > 0 ? customerCount : null,
      categoryCount: categoryCount > 0 ? categoryCount : null,
      deliveryLabel,
      hasPublishedProducts: productCount > 0,
      promo
    });
  } catch (error) {
    console.error('public home-stats:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to load home stats' });
  }
});

module.exports = router;
