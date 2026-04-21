const mongoose = require('mongoose');

const appliesToSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['all', 'category', 'product'],
      default: 'all'
    },
    categories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category'
      }
    ],
    products: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product'
      }
    ]
  },
  { _id: false }
);

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true
    },
    discountType: {
      type: String,
      enum: ['percentage', 'fixed'],
      required: true
    },
    discountValue: {
      type: Number,
      required: true,
      min: 0
    },
    minOrderAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    maxUses: {
      type: Number,
      default: null,
      min: 0
    },
    usedCount: {
      type: Number,
      default: 0,
      min: 0
    },
    perCustomerLimit: {
      type: Number,
      default: null,
      min: 1
    },
    expiresAt: {
      type: Date,
      default: null,
      index: true
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    appliesTo: {
      type: appliesToSchema,
      default: () => ({ type: 'all', categories: [], products: [] })
    }
  },
  { timestamps: true }
);

couponSchema.pre('save', function (next) {
  if (this.isModified('code') && this.code) {
    this.code = String(this.code).trim().toUpperCase();
  }
  next();
});

couponSchema.index({ isActive: 1, expiresAt: 1 });
couponSchema.index({ code: 1, isActive: 1 });

module.exports = mongoose.model('Coupon', couponSchema);
