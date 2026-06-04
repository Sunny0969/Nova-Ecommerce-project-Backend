/**
 * Download category images from URLs, upload to Cloudinary, save on Category documents.
 *
 * Run:
 *   node scripts/updateCategoryImagesFromUrls.js
 *
 * Edit CATEGORY_IMAGE_URLS below to add more categories.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Category = require('../models/Category');
const { uploadImageBuffer, deleteByPublicId, ensureConfigured } = require('../lib/cloudinary');

/** slug → full image URL */
const CATEGORY_IMAGE_URLS = {
  'baby-care':
    'https://images.unsplash.com/photo-1716972065448-e08a46809530?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MTR8fGJhYnklMjBwcm9kdWN0c3xlbnwwfHwwfHx8Mg%3D%3D',
  beverages:
    'https://images.unsplash.com/photo-1566560155396-7b9f35a08308?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8Mnx8cGVwc2klMjBhbmQlMjBjb2NhY29sYXxlbnwwfHwwfHx8Mg%3D%3D'
};

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
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI missing in backend/.env');
    process.exit(1);
  }
  if (!ensureConfigured()) {
    console.error('Cloudinary env vars missing (CLOUDINARY_CLOUD_NAME, API_KEY, API_SECRET)');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  console.log('Connected to MongoDB');

  for (const [slug, imageUrl] of Object.entries(CATEGORY_IMAGE_URLS)) {
    const cat = await Category.findOne({ slug });
    if (!cat) {
      console.warn(`[skip] Category not found: ${slug}`);
      continue;
    }

    console.log(`Updating ${slug}…`);
    const buffer = await downloadImage(imageUrl);
    const uploaded = await uploadImageBuffer(buffer, { folder: 'nova-shop/categories' });

    const oldPid = cat.image?.public_id;
    if (oldPid && oldPid !== uploaded.public_id) {
      try {
        await deleteByPublicId(oldPid);
      } catch {
        // ignore cleanup errors
      }
    }

    cat.image = { url: uploaded.url, public_id: uploaded.public_id };
    await cat.save();
    console.log(`  ✓ ${cat.name} → ${uploaded.url}`);
  }

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
