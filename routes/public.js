/**
 * Public storefront metrics — no auth required.
 */
const express = require('express');
const Product = require('../models/Product');
const User = require('../models/User');
const Category = require('../models/Category');
const { getStoreSettings } = require('../services/storeSettings');

const router = express.Router();

function ok(res, data) {
  res.json({ success: true, data });
}

async function getMaxPublishedProductDiscountPercent() {
  const rows = await Product.aggregate([
    {
      $match: {
        isPublished: true,
        comparePrice: { $gt: 0 },
        $expr: { $gt: ['$comparePrice', '$price'] }
      }
    },
    {
      $project: {
        pct: {
          $round: [
            {
              $multiply: [
                { $divide: [{ $subtract: ['$comparePrice', '$price'] }, '$comparePrice'] },
                100
              ]
            },
            0
          ]
        }
      }
    },
    { $group: { _id: null, maxPct: { $max: '$pct' } } }
  ]);

  const maxPct = Number(rows[0]?.maxPct);
  return Number.isFinite(maxPct) && maxPct > 0 ? maxPct : null;
}

async function buildPromoHighlight(settings) {
  const [productPct, freeMinRaw] = await Promise.all([
    getMaxPublishedProductDiscountPercent(),
    Promise.resolve(Number(settings?.freeShippingMin))
  ]);

  const freeMin = Number(freeMinRaw);
  const freeDeliveryNote =
    Number.isFinite(freeMin) && freeMin > 0
      ? `Free delivery over Rs ${Math.round(freeMin).toLocaleString('en-PK')}`
      : null;

  if (productPct == null) return null;

  return {
    maxDiscountPercent: productPct,
    title: `Sale — Up to ${productPct}% Off`,
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
