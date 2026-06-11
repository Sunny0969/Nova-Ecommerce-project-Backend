const mongoose = require('mongoose');

const walletTransactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    type: {
      type: String,
      enum: ['credit', 'debit'],
      required: true
    },
    reason: {
      type: String,
      enum: [
        'top_up',
        'refund',
        'cashback',
        'checkout',
        'admin_adjustment',
        'order_cancel'
      ],
      required: true
    },
    amount: {
      type: Number,
      required: true,
      min: 0.01
    },
    balanceAfter: {
      type: Number,
      required: true,
      min: 0
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: 500
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: null
    },
    /** Idempotency key — e.g. refund:orderId, cashback:orderId, checkout:orderId */
    referenceKey: {
      type: String,
      trim: true,
      default: '',
      maxlength: 120
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  { timestamps: true }
);

walletTransactionSchema.index({ referenceKey: 1 }, { unique: true, sparse: true });
walletTransactionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema);
