const mongoose = require('mongoose');

const userEventSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    /** For guests; frontend should generate and persist a stable sessionId */
    sessionId: {
      type: String,
      trim: true,
      default: '',
      maxlength: 200,
      index: true
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true
    },
    eventType: {
      type: String,
      enum: ['view', 'add_to_cart', 'purchase', 'wishlist', 'share'],
      required: true,
      index: true
    },
    duration: {
      type: Number,
      default: 0,
      min: 0
    },
    source: {
      type: String,
      trim: true,
      default: '',
      maxlength: 80
    }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

userEventSchema.index({ createdAt: -1 });
userEventSchema.index({ eventType: 1, createdAt: -1 });
userEventSchema.index({ productId: 1, eventType: 1, createdAt: -1 });
userEventSchema.index({ userId: 1, createdAt: -1 });
userEventSchema.index({ sessionId: 1, createdAt: -1 });

module.exports = mongoose.model('UserEvent', userEventSchema);

