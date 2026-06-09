/**
 * Repair product names/slugs/descriptions corrupted by bad imports (JSON in title fields).
 * Run: npm run products:repair-corrupt
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();
const Product = require('../models/Product');
const {
  sanitizeProductDoc,
  getCleanProductSlug,
  needsDescriptionCleanup
} = require('../lib/productDescription');

async function uniqueSlug(base, excludeId) {
  let slug = String(base || 'product').trim().toLowerCase().slice(0, 200);
  if (!slug) slug = 'product';
  let candidate = slug;
  let n = 0;
  while (await Product.exists({ slug: candidate, _id: { $ne: excludeId } })) {
    n += 1;
    candidate = `${slug}-${n}`.slice(0, 200);
  }
  return candidate;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  console.log('Scanning products for corrupt names/slugs/descriptions…\n');

  const cursor = Product.find({}).select('name slug shortDescription description').cursor();
  let scanned = 0;
  let updated = 0;

  for await (const doc of cursor) {
    scanned += 1;
    const payload = {
      name: doc.name,
      slug: doc.slug,
      shortDescription: doc.shortDescription || '',
      description: doc.description || ''
    };

    if (!needsDescriptionCleanup(payload)) continue;

    const cleaned = sanitizeProductDoc(payload);
    let nextSlug = doc.slug;
    if (getCleanProductSlug(payload) !== String(doc.slug || '').trim().toLowerCase()) {
      nextSlug = await uniqueSlug(getCleanProductSlug({ ...payload, name: cleaned.name }), doc._id);
    }

    await Product.updateOne(
      { _id: doc._id },
      {
        $set: {
          name: cleaned.name,
          slug: nextSlug,
          shortDescription: cleaned.shortDescription,
          description: cleaned.description
        }
      }
    );
    updated += 1;
    console.log(`  ✓ ${nextSlug} → "${cleaned.name}"`);
  }

  console.log(`\nDone. Repaired ${updated} of ${scanned} product(s).`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
