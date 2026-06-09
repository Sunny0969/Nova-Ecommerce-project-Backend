/**
 * Unpublish storefront products that have no valid image.
 * Usage: node scripts/unpublishProductsWithoutImages.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Category = require('../models/Category');
const { productHasValidImage } = require('../lib/productImageFilter');
const { syncCategoryVisibility } = require('../lib/syncCategoryVisibility');

function resolveMongoUri() {
  const uri = process.env.MONGODB_URI || '';
  if (uri.includes('/test')) return uri;
  if (uri.includes('/nova-shop')) return uri.replace('/nova-shop', '/test');
  return uri;
}

async function main() {
  await mongoose.connect(resolveMongoUri());
  const rows = await Product.find({ isPublished: true }).select('name slug productId images').lean();
  const ids = rows.filter((p) => !productHasValidImage(p)).map((p) => p._id);
  if (!ids.length) {
    console.log('No published products without images.');
    await mongoose.disconnect();
    return;
  }
  const result = await Product.updateMany({ _id: { $in: ids } }, { $set: { isPublished: false } });
  console.log(`Unpublished ${result.modifiedCount} product(s) without images:`);
  rows
    .filter((p) => !productHasValidImage(p))
    .forEach((p) => console.log(`  - ${p.name} (${p.slug || p.productId})`));
  await syncCategoryVisibility(Category, Product);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
