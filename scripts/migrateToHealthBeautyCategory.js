/**
 * One main Health & Beauty category + 8 subcategories.
 * Empty subcategories visible in admin only (storefront filters productCount > 0).
 *
 * Run: npm run migrate:health-beauty
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const ProductSubcategory = require('../models/ProductSubcategory');
const {
  HEALTH_BEAUTY_SUBCATEGORIES,
  LEGACY_CATEGORY_TO_SUB,
  LEGACY_CATEGORY_SLUGS,
  resolveHealthBeautySubcategorySlug
} = require('../lib/healthBeautySubcategories');
const { syncCategoryVisibility } = require('../lib/syncCategoryVisibility');
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');
const { flushAll, delByPrefix } = require('../lib/apiCache');
const { flushRemoteApiCache } = require('../lib/flushRemoteApiCache');

const HEALTH_BEAUTY_SPEC = {
  name: 'Health & Beauty',
  slug: 'health-beauty',
  description: 'Oral care, skin care, hair care, hygiene, grooming, and fragrances',
  displayOrder: 3,
  image: {
    url: 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=640&auto=format&fit=crop&q=80',
    public_id: ''
  }
};

async function ensureCategory() {
  return Category.findOneAndUpdate(
    { slug: HEALTH_BEAUTY_SPEC.slug },
    {
      $set: {
        name: HEALTH_BEAUTY_SPEC.name,
        slug: HEALTH_BEAUTY_SPEC.slug,
        description: HEALTH_BEAUTY_SPEC.description,
        displayOrder: HEALTH_BEAUTY_SPEC.displayOrder,
        image: HEALTH_BEAUTY_SPEC.image
      },
      $setOnInsert: { isActive: false }
    },
    { upsert: true, new: true }
  ).lean();
}

async function seedSubcategories(categoryId) {
  const bySlug = new Map();
  for (const spec of HEALTH_BEAUTY_SUBCATEGORIES) {
    const row = await ProductSubcategory.findOneAndUpdate(
      { category: categoryId, gender: '', slug: spec.slug },
      {
        $set: {
          name: spec.name,
          slug: spec.slug,
          gender: '',
          displayOrder: spec.displayOrder,
          matchKeywords: spec.matchKeywords,
          isActive: true
        }
      },
      { upsert: true, new: true }
    ).lean();
    bySlug.set(spec.slug, row);
    console.log('  ✓ sub:', spec.name);
  }
  return bySlug;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  console.log('[MongoDB] Connected');

  const healthBeauty = await ensureCategory();
  console.log('[health-beauty] Category ready:', healthBeauty.name);

  console.log('[health-beauty] Seeding subcategories...');
  const subsBySlug = await seedSubcategories(healthBeauty._id);

  let moved = 0;
  for (const legacySlug of LEGACY_CATEGORY_SLUGS) {
    const subSlug = LEGACY_CATEGORY_TO_SUB[legacySlug];
    const sub = subsBySlug.get(subSlug);
    if (!sub) continue;

    const legacyCat = await Category.findOne({ slug: legacySlug }).select('_id name').lean();
    if (!legacyCat) continue;

    const result = await Product.updateMany(
      { category: legacyCat._id },
      { $set: { category: healthBeauty._id, shopSubcategory: sub._id } }
    );
    if (result.modifiedCount > 0) {
      console.log(`  moved ${result.modifiedCount} from ${legacySlug} → ${subSlug}`);
      moved += result.modifiedCount;
    }
  }

  const unassigned = await Product.find({
    category: healthBeauty._id,
    $or: [{ shopSubcategory: null }, { shopSubcategory: { $exists: false } }]
  })
    .select('name')
    .lean();

  let keywordAssigned = 0;
  for (const p of unassigned) {
    const slug = resolveHealthBeautySubcategorySlug(p.name);
    const sub = slug ? subsBySlug.get(slug) : null;
    if (!sub) continue;
    await Product.updateOne({ _id: p._id }, { $set: { shopSubcategory: sub._id } });
    keywordAssigned += 1;
  }
  if (keywordAssigned) console.log(`  keyword-assigned ${keywordAssigned} products`);

  const published = await Product.updateMany(
    {
      category: healthBeauty._id,
      isPublished: false,
      approvalStatus: 'approved',
      images: { $elemMatch: { url: { $exists: true, $type: 'string', $nin: [''] } } }
    },
    { $set: { isPublished: true } }
  );
  console.log(`[health-beauty] Published ${published.modifiedCount} products`);

  await Category.updateMany({ slug: { $in: LEGACY_CATEGORY_SLUGS } }, { $set: { isActive: false } });
  console.log(`[health-beauty] Deactivated ${LEGACY_CATEGORY_SLUGS.length} legacy categories`);

  await syncCategoryVisibility(Category, Product);
  delByPrefix('subcategories:tree:');
  flushAll();
  invalidateCatalogCache();
  await flushRemoteApiCache();

  const final = await Category.findById(healthBeauty._id).lean();
  const productCount = await Product.countDocuments({ category: healthBeauty._id, isPublished: true });
  console.log('\nDone.');
  console.log(`  Health & Beauty isActive: ${final.isActive}`);
  console.log(`  Published products: ${productCount}`);
  console.log(`  Total moved: ${moved}`);

  for (const spec of HEALTH_BEAUTY_SUBCATEGORIES) {
    const sub = subsBySlug.get(spec.slug);
    const n = await Product.countDocuments({ category: healthBeauty._id, shopSubcategory: sub._id, isPublished: true });
    console.log(`    ${spec.name}: ${n}${n === 0 ? ' (admin only)' : ''}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('migrate:health-beauty failed:', err);
  process.exit(1);
});
