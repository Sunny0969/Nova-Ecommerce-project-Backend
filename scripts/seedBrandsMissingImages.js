/**
 * Upload images only for brands missing image.url
 * Run: node scripts/seedBrandsMissingImages.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Brand = require('../models/Brand');
const BRAND_IMAGE_URLS = require('../lib/brandImageUrls');
const { uploadImageBuffer, deleteByPublicId, ensureConfigured } = require('../lib/cloudinary');

async function downloadImage(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      Accept: 'image/*',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
    }
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  if (!ensureConfigured()) process.exit(1);
  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);

  const missing = await Brand.find({
    $or: [{ 'image.url': { $in: [null, ''] } }, { image: { $exists: false } }]
  });

  console.log(`Brands missing images: ${missing.length}`);

  for (const doc of missing) {
    const url = BRAND_IMAGE_URLS[doc.slug];
    if (!url) {
      console.warn(`  skip ${doc.slug} (no fallback URL)`);
      continue;
    }
    try {
      const buffer = await downloadImage(url);
      const uploaded = await uploadImageBuffer(buffer, { folder: 'nova-shop/brands' });
      if (doc.image?.public_id) {
        try {
          await deleteByPublicId(doc.image.public_id);
        } catch {
          /* ignore */
        }
      }
      doc.image = { url: uploaded.url, public_id: uploaded.public_id };
      await doc.save();
      console.log(`  ✓ ${doc.name}`);
    } catch (e) {
      console.warn(`  ✗ ${doc.name}: ${e.message}`);
    }
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
