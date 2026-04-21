const mongoose = require('mongoose');

const riskFactorSchema = new mongoose.Schema(
  {
    code: { type: String, required: true },
    detail: { type: String, default: '' },
    weight: { type: Number, default: 0 }
  },
  { _id: false }
);

const fraudLogSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
      index: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    ipAddress: {
      type: String,
      trim: true,
      default: ''
    },
    stripePaymentIntentId: {
      type: String,
      trim: true,
      sparse: true,
      unique: true
    },
    riskScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },
    riskFactors: {
      type: [riskFactorSchema],
      default: () => []
    },
    /** Outcome of automated scoring */
    action: {
      type: String,
      enum: ['approved', 'flagged', 'rejected'],
      required: true,
      index: true
    },
    /** Order total at check time (for stats when order exists or was blocked pre-order) */
    orderTotal: {
      type: Number,
      default: 0,
      min: 0
    },
    currency: {
      type: String,
      trim: true,
      default: ''
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    reviewedAt: {
      type: Date,
      default: null
    },
    /** After manual review of a flagged case */
    reviewAction: {
      type: String,
      enum: ['', 'approved', 'rejected'],
      default: ''
    },
    reviewNotes: {
      type: String,
      trim: true,
      default: '',
      maxlength: 2000
    }
  },
  { timestamps: true }
);

fraudLogSchema.index({ action: 1, reviewAction: 1, createdAt: -1 });
fraudLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('FraudLog', fraudLogSchema);
