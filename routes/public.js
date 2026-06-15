/**
 * Public storefront metrics — no auth required.
 */
const express = require('express');
const Product = require('../models/Product');
const User = require('../models/User');
const Category = require('../models/Category');
const { getStoreSettings } = require('../services/storeSettings');
const { getOrSet, CACHE_KEYS } = require('../lib/apiCache');
const { setPublicApiCacheHeaders } = require('../lib/publicApiCacheHeaders');
const { buildPromoTickerPayload } = require('../lib/promoTicker');

const router = express.Router();

function ok(res, data) {
  res.json({ success: true, data });
}

async function getMaxPublishedProductDiscountPercent() {
  const rows = await Product.aggregate([
    {
      $addFields: {
        compareAt: {
          $cond: {
            if: { $gt: [{ $ifNull: ['$originalPrice', 0] }, 0] },
            then: '$originalPrice',
            else: { $ifNull: ['$comparePrice', 0] }
          }
        }
      }
    },
    {
      $match: {
        isPublished: true,
        compareAt: { $gt: 0 },
        $expr: { $gt: ['$compareAt', '$price'] }
      }
    },
    {
      $project: {
        pct: {
          $round: [
            {
              $multiply: [
                { $divide: [{ $subtract: ['$compareAt', '$price'] }, '$compareAt'] },
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
  const productPct = await getMaxPublishedProductDiscountPercent();
  const maxDiscountPercent = productPct ?? 0;

  const freeMin = Number(settings?.freeShippingMin);
  const freeDeliveryNote =
    Number.isFinite(freeMin) && freeMin > 0
      ? `Free delivery on orders above Rs ${Math.round(freeMin).toLocaleString('en-PK')}`
      : null;

  return {
    maxDiscountPercent,
    title: `Sale — Up to ${maxDiscountPercent}% Off`,
    subtitle: freeDeliveryNote
      ? `Limited time • ${freeDeliveryNote}`
      : 'Limited time • Best prices on Bazaar'
  };
}

/**
 * GET /api/public/home-stats
 * Returns counts for homepage hero; null values mean "Coming Soon" on the client.
 */
router.get('/home-stats', async (req, res) => {
  try {
    const { value: data, hit } = await getOrSet(CACHE_KEYS.PUBLIC_HOME_STATS, async () => {
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

      return {
        productCount: productCount > 0 ? productCount : null,
        customerCount: customerCount > 0 ? customerCount : null,
        categoryCount: categoryCount > 0 ? categoryCount : null,
        deliveryLabel,
        hasPublishedProducts: productCount > 0,
        promo
      };
    });

    setPublicApiCacheHeaders(res, { hit });
    return ok(res, data);
  } catch (error) {
    console.error('public home-stats:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to load home stats' });
  }
});

/**
 * GET /api/public/promo-ticker
 * Active voucher codes + featured offers for the header marquee.
 */
router.get('/promo-ticker', async (req, res) => {
  try {
    const { value: data, hit } = await getOrSet(
      CACHE_KEYS.PUBLIC_PROMO_TICKER,
      () => buildPromoTickerPayload(),
      300
    );

    setPublicApiCacheHeaders(res, { hit });
    return ok(res, data);
  } catch (error) {
    console.error('public promo-ticker:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to load promo ticker' });
  }
});

/**
 * GET /api/public/stripe-config
 * Publishable key from backend — must match STRIPE_SECRET_KEY mode (live vs test).
 */
router.get('/stripe-config', (req, res) => {
  const publishableKey = (process.env.STRIPE_PUBLISHABLE_KEY || '').trim();
  const secretKey = (process.env.STRIPE_SECRET_KEY || '').trim();
  const secretLive = secretKey.startsWith('sk_live_');
  const secretTest = secretKey.startsWith('sk_test_');
  const pubLive = publishableKey.startsWith('pk_live_');
  const pubTest = publishableKey.startsWith('pk_test_');
  const modeMatch =
    (secretLive && pubLive) || (secretTest && pubTest);
  const configured = Boolean(secretKey && publishableKey && modeMatch);
  return ok(res, {
    publishableKey: configured ? publishableKey : '',
    configured,
    mode: secretLive || pubLive ? 'live' : secretTest || pubTest ? 'test' : null
  });
});

module.exports = router;
