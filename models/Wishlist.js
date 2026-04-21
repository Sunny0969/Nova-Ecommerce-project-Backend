const mongoose = require('mongoose');

const wishlistSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true
    },
    products: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        index: true
      }
    ]
  },
  { timestamps: true }
);

wishlistSchema.index({ user: 1, updatedAt: -1 });

module.exports = mongoose.model('Wishlist', wishlistSchema);
