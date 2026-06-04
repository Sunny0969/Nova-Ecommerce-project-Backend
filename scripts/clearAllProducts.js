/**
 * Remove all products and product-linked rows from the database in MONGODB_URI.
 * Run: node scripts/clearAllProducts.js
 * Optional: node scripts/clearAllProducts.js --yes  (skip confirmation prompt)
 */
const path = require('path');
const readline = require('readline');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const {
  configureMongoDns,
  MONGOOSE_CONNECT_OPTS
} = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Product = require('../models/Product');
const Review = require('../models/Review');
const ProductEmbedding = require('../models/ProductEmbedding');
const StockNotification = require('../models/StockNotification');
const SearchAnalyticsEvent = require('../models/SearchAnalyticsEvent');
const UserEvent = require('../models/UserEvent');
const Cart = require('../models/Cart');
const Wishlist = require('../models/Wishlist');
const Coupon = require('../models/Coupon');

const MONGODB_URI = process.env.MONGODB_URI;
const skipConfirm = process.argv.includes('--yes');

function maskUri(uri) {
  return String(uri || '').replace(/:([^:@/]+)@/, ':****@');
}

async function confirm(message) {
  if (skipConfirm) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question(`${message} (yes/no): `, (a) => {
      rl.close();
      resolve(a);
    });
  });
  return String(answer).trim().toLowerCase() === 'yes';
}

async function main() {
  if (!MONGODB_URI) {
    console.error('MONGODB_URI is not set in backend/.env');
    process.exit(1);
  }

  console.log('Target database:', maskUri(MONGODB_URI));

  const ok = await confirm(
    'Delete ALL products and related cart/wishlist/review data? This cannot be undone.'
  );
  if (!ok) {
    console.log('Cancelled.');
    process.exit(0);
  }

  await mongoose.connect(MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  console.log('[MongoDB] Connected');

  const productCount = await Product.countDocuments();
  console.log(`Found ${productCount} product(s).`);

  const [reviews, embeddings, stockNotes, searchEvents, userEvents, carts, wishlists, coupons] =
    await Promise.all([
      Review.deleteMany({}),
      ProductEmbedding.deleteMany({}),
      StockNotification.deleteMany({}),
      SearchAnalyticsEvent.deleteMany({ productId: { $exists: true, $ne: null } }),
      UserEvent.deleteMany({ productId: { $exists: true, $ne: null } }),
      Cart.updateMany({}, { $set: { items: [], coupon: null, discountAmount: 0 } }),
      Wishlist.updateMany({}, { $set: { products: [] } }),
      Coupon.updateMany(
        { 'appliesTo.products.0': { $exists: true } },
        { $set: { 'appliesTo.products': [], 'appliesTo.type': 'all' } }
      )
    ]);

  const productResult = await Product.deleteMany({});

  console.log('Done:');
  console.log(`  products deleted: ${productResult.deletedCount}`);
  console.log(`  reviews deleted: ${reviews.deletedCount}`);
  console.log(`  product embeddings deleted: ${embeddings.deletedCount}`);
  console.log(`  stock notifications deleted: ${stockNotes.deletedCount}`);
  console.log(`  search analytics (product) deleted: ${searchEvents.deletedCount}`);
  console.log(`  user events (product) deleted: ${userEvents.deletedCount}`);
  console.log(`  carts cleared: ${carts.modifiedCount}`);
  console.log(`  wishlists cleared: ${wishlists.modifiedCount}`);
  console.log(`  coupons product lists cleared: ${coupons.modifiedCount}`);

  await mongoose.disconnect();
  console.log('[MongoDB] Disconnected');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
