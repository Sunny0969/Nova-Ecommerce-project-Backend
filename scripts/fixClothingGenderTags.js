/**
 * Fix clothing gender/subcategory tags (e.g. "women" wrongly matched as men).
 * Run: node scripts/fixClothingGenderTags.js
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

  const cat = await Category.findOne({ slug: 'clothing' }).select('_id');
  if (!cat) throw new Error('Clothing category not found');

  const subs = await ProductSubcategory.find({ category: cat._id, isActive: true }).lean();
  const subMap = new Map(subs.map((s) => [`${s.gender}:${s.slug}`, s._id]));

  const products = await Product.find({ category: cat._id }).select('name tags shortDescription slug').lean();

  for (const p of products) {
    const gender = inferGender(p);
    const slug = inferSubSlug(p);
    const subId = subMap.get(`${gender}:${slug}`) || subMap.get(`${gender}:3-piece`);

    await Product.updateOne(
      { _id: p._id },
      { $set: { shopGender: gender, shopSubcategory: subId } }
    );
    console.log(`Fixed: ${p.name.slice(0, 55)}… → ${gender} / ${slug}`);
  }

  const dup = await Product.findOne({
    slug: 'asim-jofa-chiffon-embroidered-3pc-unstitched-suit-2025-luxury-designer-collection-with-embroidered-dupatta-and-trouser-2'
  });
  if (dup) {
    await Product.updateOne({ _id: dup._id }, { $set: { isPublished: false } });
    console.log('Unpublished duplicate Asim Jofa listing (-2 slug)');
  }

  delByPrefix('subcategories:tree:');
  invalidateCatalogCache();
  console.log('\nDone.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
