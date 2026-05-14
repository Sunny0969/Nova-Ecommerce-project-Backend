const mongoose = require('mongoose');

/**
 * Singleton-style store configuration (one document).
 * Shipping & tax apply to checkout / orders; amounts are in store currency (e.g. PKR).
 */
const storeSettingsSchema = new mongoose.Schema(
  {
    freeShippingMin: {
      type: Number,
      default: 50,
      min: 0
    },
    shippingStandard: {
      type: Number,
      default: 299,
      min: 0
    },
    shippingExpress: {
      type: Number,
      default: 5.99,
      min: 0
    },
    shippingNextDay: {
      type: Number,
      default: 9.99,
      min: 0
    },
    /** Decimal rate on subtotal after discount, e.g. 0.16 = 16%. 0 = no tax line. */
    taxRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 1
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('StoreSettings', storeSettingsSchema);
