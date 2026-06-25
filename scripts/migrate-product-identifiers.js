/**
 * Backfill MongoDB product identifier fields (no SQL migration).
 * Usage: node backend/scripts/migrate-product-identifiers.js [--dry-run]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Product = require('../models/Product');
const { inferBrandFromProductName, resolveProductSku } = require('../lib/productIdentifiers');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('Missing MONGODB_URI');
    process.exit(1);
  }

  await mongoose.connect(uri);

  const products = await Product.find({ isPublished: true })
    .select('slug name sku brandName gtin manufacturer')
    .lean();

  let updated = 0;
  for (const product of products) {
    const patch = {};
    if (!product.brandName) {
      const brand = inferBrandFromProductName(product.name);
      if (brand) {
        patch.brandName = brand;
        if (!product.manufacturer) patch.manufacturer = brand;
      }
    }
    if (!product.sku) {
      const sku = resolveProductSku(product);
      if (sku) patch.sku = sku;
    }
    if (!Object.keys(patch).length) continue;

    if (!dryRun) {
      await Product.updateOne({ _id: product._id }, { $set: patch });
    }
    updated += 1;
    console.log(`[migrate-identifiers] ${product.slug}:`, patch);
  }

  console.log(
    `[migrate-identifiers] ${dryRun ? 'Would update' : 'Updated'} ${updated} of ${products.length} product(s).`
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
