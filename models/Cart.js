const mongoose = require('mongoose');

const cartLineSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Each line must reference a product']
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, 'Quantity must be at least 1'],
      validate: {
        validator: (v) => Number.isInteger(v),
        message: 'Quantity must be a whole number'
      }
    },
    price: {
      type: Number,
      min: [0, 'Price cannot be negative'],
      default: null
    }
  },
  { _id: false }
);

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Cart must belong to a user'],
      unique: true,
      index: true
    },
    items: {
      type: [cartLineSchema],
      default: [],
      validate: {
        validator(items) {
          if (!items?.length) return true;
          const ids = items.map((i) => String(i.product));
          return ids.length === new Set(ids).size;
        },
        message: 'Cart cannot contain duplicate product references'
      }
    },
    coupon: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Coupon',
      default: null,
      index: true
    },
    discountAmount: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  { timestamps: true }
);

/**
 * Computes subtotal from line prices (falls back to populated product.price when line.price is missing).
 * @returns {{ itemsSubtotal: number, discountAmount: number, total: number }}
 */
cartSchema.methods.calculateTotals = function () {
  const itemsSubtotal = (this.items || []).reduce((sum, line) => {
    const unit =
      line.price != null && line.price >= 0
        ? line.price
        : line.product && typeof line.product === 'object' && line.product.price != null
          ? line.product.price
          : 0;
    return sum + unit * (line.quantity || 0);
  }, 0);
  const discount = Number(this.discountAmount) || 0;
  return {
    itemsSubtotal,
    discountAmount: discount,
    total: Math.max(0, itemsSubtotal - discount)
  };
};

cartSchema.index({ user: 1, updatedAt: -1 });

module.exports = mongoose.model('Cart', cartSchema);
