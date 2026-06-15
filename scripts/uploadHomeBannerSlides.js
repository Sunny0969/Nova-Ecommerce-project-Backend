/**
 * Upload homepage slider JPGs to Cloudinary and write public IDs for the frontend.
 * Run from repo root: node backend/scripts/uploadHomeBannerSlides.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { uploadImageFile, ensureConfigured } = require('../lib/cloudinary');

const SLIDER_DIR = path.join(__dirname, '../../frontend/src/assets/images/slider');
const OUT_FILE = path.join(__dirname, '../../frontend/src/config/homeBannerCloudinary.json');

const FILES = [
  { key: 'summer-sale', file: 'summer-sale.jpg' },
  { key: 'image-03', file: 'image-03.jpg' },
  { key: 'pet-store', file: 'pet-store.jpg' }
];

async function main() {
  if (!ensureConfigured()) {
    console.error('[uploadHomeBannerSlides] Cloudinary env vars missing.');
    process.exit(1);
  }

  const out = {};
  for (const { key, file } of FILES) {
    const filePath = path.join(SLIDER_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.error(`[uploadHomeBannerSlides] Missing file: ${filePath}`);
      process.exit(1);
    }
    const result = await uploadImageFile(filePath, { folder: 'bazaar/home-banners' });
    out[key] = {
      public_id: result.public_id,
      url: result.url
    };
    console.log(`[uploadHomeBannerSlides] ${file} → ${result.public_id}`);
  }

  fs.writeFileSync(OUT_FILE, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`[uploadHomeBannerSlides] Wrote ${OUT_FILE}`);
}

main().catch((err) => {
  console.error('[uploadHomeBannerSlides] Failed:', err.message || err);
  process.exit(1);
});
