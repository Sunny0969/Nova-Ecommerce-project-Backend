/**
 * Ensure published products have at least 3 DB reviews for Google Product schema.
 * Usage: node backend/scripts/seed-product-reviews-for-schema.js [--limit=50] [--slug=product-slug]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Review = require('../models/Review');
const { generateFakeReviewsForProduct } = require('../utils/generateFakeReviews');

const MIN_REVIEWS = 3;

async function main() {
  const args = process.argv.slice(2);
  const slugArg = args.find((a) => a.startsWith('--slug='))?.split('=')[1];
  const limitArg = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] || 50);

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('Missing MONGODB_URI');
    process.exit(1);
  }

  await mongoose.connect(uri);

  const filter = { isPublished: true };
  if (slugArg) filter.slug = String(slugArg).toLowerCase().trim();

  const products = await Product.find(filter).select('_id slug name').limit(limitArg).lean();
  let updated = 0;

  for (const product of products) {
    const count = await Review.countDocuments({ product: product._id });
    if (count >= MIN_REVIEWS) continue;

    const needed = MIN_REVIEWS - count;
    const result = await generateFakeReviewsForProduct({
      productId: product._id,
      productName: product.name,
      minReviews: needed,
      maxReviews: needed
    });
    if (result.created > 0) {
      updated += 1;
      console.log(`[seed] ${product.slug}: +${result.created} reviews (was ${count})`);
    }
  }

  console.log(`[seed] Done — ${updated} product(s) received new reviews.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
