const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },
    comment: {
      type: String,
      default: '',
      maxlength: [2000, 'Comment is too long']
    },
    /** What the customer is highlighting (dropdown on review form). */
    topic: {
      type: String,
      trim: true,
      default: '',
      maxlength: 40,
      index: true
    },
    images: {
      type: [
        {
          url: { type: String, trim: true, default: '' },
          publicId: { type: String, trim: true, default: '' }
        }
      ],
      default: () => []
    },
    isVerifiedPurchase: {
      type: Boolean,
      default: false,
      index: true
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  { timestamps: false }
);

reviewSchema.index({ user: 1, product: 1 }, { unique: true });
reviewSchema.index({ product: 1, createdAt: -1 });
reviewSchema.index({ rating: 1 });

module.exports = mongoose.model('Review', reviewSchema);
