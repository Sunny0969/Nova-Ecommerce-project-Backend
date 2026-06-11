const mongoose = require('mongoose');

/**
 * Singleton-style store configuration (one document).
 * Shipping & tax apply to checkout / orders; amounts are in store currency (e.g. PKR).
 */
const storeSettingsSchema = new mongoose.Schema(
  {
    freeShippingMin: {
      type: Number,
      default: 2026,
      min: 0
    },
    shippingStandard: {
      type: Number,
      default: 299,
      min: 0
    },
    shippingExpress: {
      type: Number,
      default: 499,
      min: 0
    },
    shippingNextDay: {
      type: Number,
      default: 599,
      min: 0
    },
    /** Decimal rate on subtotal after discount, e.g. 0.16 = 16%. 0 = no tax line. */
    taxRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 1
    },
    /** When true, standard shipping uses cart weight instead of flat shippingStandard. */
    weightShippingEnabled: {
      type: Boolean,
      default: true
    },
    /** Weight threshold in kg — shippingUpToThresholdKg applies at or below this total cart weight. */
    weightShippingThresholdKg: {
      type: Number,
      default: 1,
      min: 0.01
    },
    /** Standard shipping (PKR) when total cart weight is at or below weightShippingThresholdKg. */
    shippingUpToThresholdKg: {
      type: Number,
      default: 300,
      min: 0
    },
    /** Extra PKR per started kg over weightShippingThresholdKg. */
    shippingAdditionalPerKgOver: {
      type: Number,
      default: 150,
      min: 0
    },
    /** Fallback product weight (kg) when a line has no weightKg / weight text. */
    defaultProductWeightKg: {
      type: Number,
      default: 1,
      min: 0.01
    },
    walletCashbackEnabled: {
      type: Boolean,
      default: true
    },
    /** Minimum order total (PKR) to earn walletCashbackAmount. */
    walletCashbackMinOrder: {
      type: Number,
      default: 5000,
      min: 0
    },
    /** Flat cashback credited to wallet when order is delivered. */
    walletCashbackAmount: {
      type: Number,
      default: 500,
      min: 0
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('StoreSettings', storeSettingsSchema);
