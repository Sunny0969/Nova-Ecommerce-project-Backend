/**
 * Fix product descriptions that contain leaked import JSON metadata (all products).
 * Run: npm run products:clean-descriptions
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../models/Product');
const { sanitizeProductDoc, needsDescriptionCleanup } = require('../lib/productDescription');
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('Set MONGODB_URI in .env');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('Connected to MongoDB\n');

  const cursor = Product.find({}).select('name slug shortDescription description').cursor();

  let scanned = 0;
  let updated = 0;

  for await (const doc of cursor) {
    scanned += 1;
    const payload = {
      name: doc.name,
      shortDescription: doc.shortDescription || '',
      description: doc.description || ''
    };

    if (!needsDescriptionCleanup(payload)) continue;

    const cleaned = sanitizeProductDoc(payload);
    await Product.updateOne(
      { _id: doc._id },
      {
        $set: {
          shortDescription: cleaned.shortDescription,
          description: cleaned.description
        }
      }
    );
    updated += 1;
    if (updated <= 20 || updated % 100 === 0) {
      console.log(`  ✓ [${updated}] ${doc.name}`);
    }
  }

  console.log(`\nDone. Updated ${updated} of ${scanned} product(s).`);
  if (updated > 0) invalidateCatalogCache();
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
