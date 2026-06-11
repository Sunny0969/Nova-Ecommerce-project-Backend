/**
 * Refresh imported perfume short + long descriptions (no price/admin boilerplate).
 * Run: node scripts/cleanImportedPerfumeCopy.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { sanitizeProductDoc } = require('../lib/productDescription');
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI missing');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const cat = await Category.findOne({ slug: 'imported-perfume' }).select('_id');
  if (!cat) {
    console.error('Category imported-perfume not found');
    process.exit(1);
  }

  const products = await Product.find({ category: cat._id }).select(
    'name shortDescription description tags slug'
  );

  let updated = 0;
  for (const doc of products) {
    const raw = doc.toObject();
    const cleaned = sanitizeProductDoc(raw);
    const nextShort = cleaned.shortDescription;
    const nextDesc = cleaned.description;
    const prevShort = String(raw.shortDescription || '').trim();
    const prevDesc = String(raw.description || '').trim();

    if (nextShort !== prevShort || nextDesc !== prevDesc) {
      await Product.updateOne(
        { _id: doc._id },
        { $set: { shortDescription: nextShort, description: nextDesc } }
      );
      updated += 1;
      console.log(`  ✓ ${doc.name.slice(0, 60)}`);
    }
  }

  if (updated > 0) invalidateCatalogCache();
  console.log(`\nDone. Updated ${updated} of ${products.length} imported perfume(s).`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
