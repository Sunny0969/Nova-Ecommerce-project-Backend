/**
 * Import Blue Pottery category + products from saved HTML (or live Punjab catalog).
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

const DEFAULT_HTML = path.join('C:', 'Users', 'PC', 'Downloads', 'Blue Pottery.htm');

const CATEGORY = {
  categorySlug: 'blue-pottery',
  categoryName: 'Blue Pottery',
  displayOrder: -1,
  categoryImage: {
    url: 'https://images.unsplash.com/photo-1769874828707-6e9600e2ee75?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MTl8fGJsdWUlMjBwb3R0ZXJ5fGVufDB8MHwwfHx8Mg%3D%3D',
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
  const candidates = [argPath, process.env.BLUE_POTTERY_HTML, DEFAULT_HTML].filter(Boolean);
  for (const p of candidates) {
    const resolved = path.resolve(p);
    if (fs.existsSync(resolved)) {
      return { htmlPath: resolved };
    }
  }
  return { fetchCategorySlug: 'blue-pottery' };
}

async function main() {
  const uri = resolveMongoUri();
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  const source = await resolveImportSource();
  const result = await importHandicraftCategoryToDb({ Category, Product }, { ...CATEGORY, ...source });
  console.log(JSON.stringify(result, null, 2));
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
