const mongoose = require('mongoose');
const Product = require('../models/Product');
const Review = require('../models/Review');

async function recalculateProductRatings(productId) {
  const stats = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(productId) } },
    {
      $group: {
        _id: null,
        avgRating: { $avg: '$rating' },
        n: { $sum: 1 }
      }
    }
  ]);
  const avg =
    stats[0] && stats[0].n > 0
      ? Math.round(stats[0].avgRating * 10) / 10
      : 0;
  const n = stats[0]?.n || 0;
  await Product.updateOne(
    { _id: productId },
    { $set: { ratings: avg, numReviews: n } }
  );
}

module.exports = { recalculateProductRatings };
