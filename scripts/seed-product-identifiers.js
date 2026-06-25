/**
 * Backfill brand, GTIN, SKU, and manufacturer for GSC global identifiers.
 * Usage: node backend/scripts/seed-product-identifiers.js [--dry-run] [--all]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const seeds = require('../data/product-identifier-seeds.json');
const {
  inferBrandFromProductName,
  resolveProductSku
} = require('../lib/productIdentifiers');

function matchSeed(product) {
  const slug = String(product.slug || '').toLowerCase();
  return seeds.find((row) => slug.includes(String(row.slugContains || '').toLowerCase()));
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const allProducts = process.argv.includes('--all');
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('Missing MONGODB_URI');
    process.exit(1);
  }

  await mongoose.connect(uri);

  const products = await Product.find(allProducts ? {} : { isPublished: true })
    .select('slug name sku brandName gtin upc ean mpn manufacturer')
    .lean();

  let updated = 0;
  for (const product of products) {
    const seed = matchSeed(product);
    const inferredBrand = inferBrandFromProductName(product.name);
    const patch = {};

    if (seed) {
      if (seed.brandName) patch.brandName = seed.brandName;
      if (seed.gtin) {
        patch.gtin = seed.gtin;
        patch.ean = seed.gtin;
      }
      if (seed.sku) patch.sku = seed.sku;
      if (seed.manufacturer) patch.manufacturer = seed.manufacturer;
      if (seed.mpn) patch.mpn = seed.mpn;
    } else if (inferredBrand && !product.brandName) {
      patch.brandName = inferredBrand;
      patch.manufacturer = inferredBrand;
    }

    if (!product.sku && !patch.sku) {
      const generated = resolveProductSku(product);
      if (generated) patch.sku = generated;
    }

    const keys = Object.keys(patch);
    if (!keys.length) continue;

    const changed = keys.some((key) => String(product[key] || '') !== String(patch[key] || ''));
    if (!changed) continue;

    if (!dryRun) {
      await Product.updateOne({ _id: product._id }, { $set: patch });
    }
    updated += 1;
    console.log(`[seed-identifiers] ${product.slug}: ${keys.join(', ')}`);
  }

  console.log(
    `[seed-identifiers] ${dryRun ? 'Would update' : 'Updated'} ${updated} of ${products.length} product(s).`
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
