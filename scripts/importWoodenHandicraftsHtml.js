/**
 * Import Wooden Handicrafts category + products from saved HTML (or live Punjab catalog).
 *
 * Usage:
 *   npm run import:wooden-handicrafts
 *   node scripts/importWoodenHandicraftsHtml.js "C:/Users/PC/Downloads/Wooden Handicrafts.htm"
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const { configureMongoDns } = require('../lib/configureMongoDns');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { importHandicraftCategoryToDb } = require('../lib/importHandicraftCategoryToDb');

configureMongoDns();

const DEFAULT_HTML = path.join('C:', 'Users', 'PC', 'Downloads', 'Wooden Handicrafts.htm');

const CATEGORY = {
  categorySlug: 'wooden-handicrafts',
  categoryName: 'Wooden Handicrafts',
  displayOrder: -2,
  categoryImage: {
    url: 'https://images.unsplash.com/photo-1670960738199-8798092a7d3f?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MTV8fHdvb2RlbiUyMGhhbmRpY3JhZnRzfGVufDB8MHwwfHx8Mg%3D%3D',
    public_id: ''
  }
};

function resolveMongoUri() {
  const uri = process.env.MONGODB_URI || '';
  if (process.env.MONGODB_DB === 'test' || uri.includes('/test')) return uri;
  if (uri.includes('/nova-shop')) return uri.replace('/nova-shop', '/test');
  return uri;
}

async function resolveImportSource() {
  const argPath = process.argv[2];
  const candidates = [argPath, process.env.WOODEN_HANDICRAFTS_HTML, DEFAULT_HTML].filter(Boolean);
  for (const p of candidates) {
    const resolved = path.resolve(p);
    if (fs.existsSync(resolved)) {
      console.log(`Using HTML file: ${resolved}`);
      return { htmlPath: resolved };
    }
  }
  console.log('HTML file not found — fetching live category page from Punjab Handicrafts…');
  return { fetchCategorySlug: 'wooden-handicrafts' };
}

async function main() {
  const uri = resolveMongoUri();
  if (!uri) throw new Error('MONGODB_URI is required');

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  console.log(`Connected to MongoDB (${uri.replace(/\/\/[^@]+@/, '//***@')})\n`);

  const source = await resolveImportSource();
  const result = await importHandicraftCategoryToDb(
    { Category, Product },
    { ...CATEGORY, ...source, fillMissingImages: true }
  );

  console.log(`Category: ${result.category.name} (${result.category.slug})`);
  console.log(`Products imported: ${result.products.length}`);
  result.products.forEach((p) => console.log(`  - ${p.name} · Rs ${p.price} · /shop/${p.slug}`));
  if (result.unpublishedStale) {
    console.log(`Unpublished stale products: ${result.unpublishedStale}`);
  }
  console.log(
    `\nVisibility sync: ${result.visibility.activated} activated, ${result.visibility.deactivated} hidden`
  );

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
