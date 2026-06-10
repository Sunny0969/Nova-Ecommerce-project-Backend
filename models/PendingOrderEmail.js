const mongoose = require('mongoose');

const pendingOrderEmailSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      unique: true,
      index: true
    },
    status: {
      type: String,
      enum: ['pending', 'sent', 'failed'],
      default: 'pending',
      index: true
    },
    customerNotified: { type: Boolean, default: false },
    adminNotified: { type: Boolean, default: false },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
    shippingSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    sentAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('PendingOrderEmail', pendingOrderEmailSchema);
