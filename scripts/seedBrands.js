/**
 * Seed brands + upload logos to Cloudinary (Clearbit / Unsplash URLs).
 *
 * Run:
 *   node scripts/seedBrands.js
 *   node scripts/seedBrands.js --skip-images   (metadata only)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Brand = require('../models/Brand');
const HOME_BRANDS = require('../lib/homeBrandsSeed');
const BRAND_IMAGE_URLS = require('../lib/brandImageUrls');
const { uploadImageBuffer, deleteByPublicId, ensureConfigured } = require('../lib/cloudinary');

const skipImages = process.argv.includes('--skip-images');

function urlsForBrand(brand) {
  const slug = String(brand.slug || '').toLowerCase();
  const urls = [];
  if (brand.imageUrl) urls.push(brand.imageUrl);
  if (BRAND_IMAGE_URLS[slug] && !urls.includes(BRAND_IMAGE_URLS[slug])) {
    urls.push(BRAND_IMAGE_URLS[slug]);
  }
  if (brand.domain) {
    const clearbit = `https://logo.clearbit.com/${brand.domain}`;
    if (!urls.includes(clearbit)) urls.push(clearbit);
  }
  return urls;
}

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
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('Empty image');
  return buf;
}

async function downloadWithFallback(brand) {
  const urls = urlsForBrand(brand);
  if (!urls.length) throw new Error('No image URL');
  let lastErr = null;
  for (const u of urls) {
    try {
      return await downloadImage(u);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('No image URL');
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI missing');
    process.exit(1);
  }
  if (!skipImages && !ensureConfigured()) {
    console.error('Cloudinary not configured');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  console.log(`Seeding ${HOME_BRANDS.length} brands… (skipImages=${skipImages})`);

  let created = 0;
  let updated = 0;

  for (const row of HOME_BRANDS) {
    const slug = String(row.slug).toLowerCase().trim();
    let doc = await Brand.findOne({ slug });
    const isNew = !doc;
    if (!doc) {
      doc = new Brand({ slug });
      created += 1;
    } else {
      updated += 1;
    }

    doc.name = row.name;
    doc.isPopular = Boolean(row.isPopular);
    doc.displayOrder = Number(row.displayOrder) || 0;
    doc.isActive = true;

    if (!skipImages) {
      try {
        const buffer = await downloadWithFallback(row);
        const uploaded = await uploadImageBuffer(buffer, { folder: 'nova-shop/brands' });
        const oldPid = doc.image?.public_id;
        if (oldPid && oldPid !== uploaded.public_id) {
          try {
            await deleteByPublicId(oldPid);
          } catch {
            /* ignore */
          }
        }
        doc.image = { url: uploaded.url, public_id: uploaded.public_id };
        console.log(`  ✓ ${row.name}`);
      } catch (e) {
        console.warn(`  ⚠ ${row.name}: ${e.message}`);
      }
    }

    await doc.save();
  }

  console.log({ created, updated, total: HOME_BRANDS.length });
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
