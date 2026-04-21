const mongoose = require('mongoose');

/** One row per failed PaymentIntent (webhook) for fraud velocity rules. */
const paymentFailureLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    stripePaymentIntentId: {
      type: String,
      required: true,
      trim: true
    }
  },
  { timestamps: true }
);

paymentFailureLogSchema.index({ user: 1, createdAt: -1 });
paymentFailureLogSchema.index(
  { stripePaymentIntentId: 1 },
  { unique: true, sparse: true }
);

module.exports = mongoose.model('PaymentFailureLog', paymentFailureLogSchema);
