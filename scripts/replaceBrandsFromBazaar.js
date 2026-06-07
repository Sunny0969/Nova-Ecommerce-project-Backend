/**
 * Replace /brands page logos from saved Bazaar HTML (only brands with products in DB).
 *
 * Run:
 *   npm run brands:replace-bazaar
 *   npm run brands:replace-bazaar -- --file="C:/Users/PC/Desktop/Bazaar App ....htm"
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
const Brand = require('../models/Brand');
const Product = require('../models/Product');
const { replaceBrandsFromBazaarHtml } = require('../lib/replaceBrandsFromBazaar');

configureMongoDns();

function argValue(prefix) {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (!hit) return null;
  const [, v] = hit.split('=');
  return v == null ? null : v.replace(/^["']|["']$/g, '');
}

const DEFAULT_FILE = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  'Desktop',
  'Bazaar App _ Online Grocery Delivery in Pakistan at Best Prices.htm'
);

async function run() {
  const filePath = argValue('--file=') || DEFAULT_FILE;

  try {
    if (!process.env.MONGODB_URI) {
      console.error('MONGODB_URI is not set');
      process.exit(1);
    }

    await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);
    console.log('[MongoDB] Connected');
    console.log('[brands] Reading:', filePath);

    const result = await replaceBrandsFromBazaarHtml(Brand, Product, filePath);
    console.log(
      `[brands] ${result.replaced} brands replaced (${result.bazaarBrandsInFile} in file, ${result.htmlBrandLogos} logos parsed)`
    );
    result.brands.slice(0, 15).forEach((b) => console.log(`  - ${b.name}`));
    if (result.brands.length > 15) {
      console.log(`  ... and ${result.brands.length - 15} more`);
    }

    process.exit(0);
  } catch (err) {
    console.error('[brands] Failed:', err.message);
    process.exit(1);
  }
}

run();
