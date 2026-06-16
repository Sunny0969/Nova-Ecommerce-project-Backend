/**
 * Seed clothing shop subcategories + assign all clothing products.
 *
 * Run: node scripts/seedClothingSubcategories.js
 */
require('dotenv').config();
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const ProductSubcategory = require('../models/ProductSubcategory');
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');
const { delByPrefix } = require('../lib/apiCache');

const CATEGORY_SLUG = 'clothing';

const DEFAULT_SUBCATEGORIES = [
  { gender: 'women', name: '3 Piece', slug: '3-piece', displayOrder: 1 },
  { gender: 'women', name: '2 Piece', slug: '2-piece', displayOrder: 2 },
  { gender: 'women', name: 'Stitched', slug: 'stitched', displayOrder: 3 },
  { gender: 'women', name: 'Unstitched', slug: 'unstitched', displayOrder: 4 },
  { gender: 'men', name: '3 Piece', slug: '3-piece', displayOrder: 1 },
  { gender: 'men', name: '2 Piece', slug: '2-piece', displayOrder: 2 },
  { gender: 'men', name: 'Stitched', slug: 'stitched', displayOrder: 3 },
  { gender: 'men', name: 'Unstitched', slug: 'unstitched', displayOrder: 4 }
];

function productText(p) {
  return `${p.name || ''} ${(p.tags || []).join(' ')} ${p.shortDescription || ''}`.toLowerCase();
}

function inferGender(p) {
  const t = productText(p);
  if (/\bwomen\b|\bladies\b|women unstitched|ladies suit|feminine/.test(t)) return 'women';
  if (/men unstitched|\bmen's\b|\bfor men\b|\bmen wear\b|\bmen only\b/.test(t)) return 'men';
  return 'women';
}

function inferSubSlug(p) {
  const t = productText(p);
  const has2 = /\b2\s*-?\s*piece\b|\b2pc\b|two piece|1 piece stitched/.test(t);
  const has3 = /\b3\s*-?\s*piece\b|\b3pc\b|three piece|\b4\s*-?\s*piece\b|\b4pc\b/.test(t);
  const unstitched = /\bunstitched\b/.test(t);
  const stitched = /\bstitched\b/.test(t) && !unstitched;

  if (has2 && !has3) return '2-piece';
  if (unstitched) return 'unstitched';
  if (stitched) return 'stitched';
  if (has3) return '3-piece';
  return '3-piece';
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);

  const cat = await Category.findOne({ slug: CATEGORY_SLUG }).select('_id name');
  if (!cat) throw new Error('Clothing category not found');

  const subMap = new Map();
  for (const row of DEFAULT_SUBCATEGORIES) {
    const doc = await ProductSubcategory.findOneAndUpdate(
      { category: cat._id, gender: row.gender, slug: row.slug },
      {
        $set: {
          name: row.name,
          displayOrder: row.displayOrder,
          isActive: true
        },
        $setOnInsert: {
          category: cat._id,
          gender: row.gender,
          slug: row.slug
        }
      },
      { upsert: true, new: true }
    );
    subMap.set(`${row.gender}:${row.slug}`, doc._id);
    console.log(`Subcategory: ${row.gender} / ${row.name}`);
  }

  const products = await Product.find({ category: cat._id }).select('name tags shortDescription').lean();
  let updated = 0;

  for (const p of products) {
    const gender = inferGender(p);
    const slug = inferSubSlug(p);
    const subId = subMap.get(`${gender}:${slug}`) || subMap.get(`${gender}:3-piece`);

    await Product.updateOne(
      { _id: p._id },
      { $set: { shopGender: gender, shopSubcategory: subId } }
    );
    updated += 1;
    console.log(`  → ${p.name.slice(0, 55)}… | ${gender} / ${slug}`);
  }

  delByPrefix('subcategories:tree:');
  invalidateCatalogCache();

  console.log(`\nDone. ${updated} clothing products tagged.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
