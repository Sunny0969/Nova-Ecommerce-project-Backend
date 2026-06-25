/**
 * Backfill availabilityStatus on products from stock (MongoDB — no SQL migration).
 * Usage: node backend/scripts/migrate-product-availability.js [--dry-run]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Product = require('../models/Product');
const { resolveProductAvailabilityStatus } = require('../lib/productAvailability');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('Missing MONGODB_URI');
    process.exit(1);
  }

  await mongoose.connect(uri);

  const products = await Product.find({})
    .select('slug name stock isPublished availabilityStatus')
    .lean();

  let updated = 0;
  for (const product of products) {
    const status = resolveProductAvailabilityStatus({
      ...product,
      stockQuantity: product.stock
    });
    if (product.availabilityStatus === status) continue;
    if (!dryRun) {
      await Product.updateOne({ _id: product._id }, { $set: { availabilityStatus: status } });
    }
    updated += 1;
    console.log(`[migrate] ${product.slug}: ${product.availabilityStatus || '(empty)'} → ${status}`);
  }

  console.log(
    `[migrate] ${dryRun ? 'Would update' : 'Updated'} ${updated} of ${products.length} product(s).`
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
