/**
 * One main Home Care category + 6 subcategories.
 * Empty subcategories visible in admin only (storefront filters productCount > 0).
 *
 * Run: npm run migrate:home-care
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
  HOME_CARE_SUBCATEGORIES,
  LEGACY_CATEGORY_TO_SUB,
  LEGACY_CATEGORY_SLUGS,
  resolveHomeCareSubcategorySlug
} = require('../lib/homeCareSubcategories');
const { syncCategoryVisibility } = require('../lib/syncCategoryVisibility');
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');
const { flushAll, delByPrefix } = require('../lib/apiCache');
const { flushRemoteApiCache } = require('../lib/flushRemoteApiCache');

const HOME_CARE_SPEC = {
  name: 'Home Care',
  slug: 'home-care',
  description: 'Laundry, cleaning, tissues, disposables, air fresheners, and pest control',
  displayOrder: 4,
  image: {
    url: 'https://images.unsplash.com/photo-1583947581924-860bda6a26df?w=640&auto=format&fit=crop&q=80',
    public_id: ''
  }
};

async function ensureCategory() {
  return Category.findOneAndUpdate(
    { slug: HOME_CARE_SPEC.slug },
    {
      $set: {
        name: HOME_CARE_SPEC.name,
        slug: HOME_CARE_SPEC.slug,
        description: HOME_CARE_SPEC.description,
        displayOrder: HOME_CARE_SPEC.displayOrder,
        image: HOME_CARE_SPEC.image
      },
      $setOnInsert: { isActive: false }
    },
    { upsert: true, new: true }
  ).lean();
}

async function seedSubcategories(categoryId) {
  const bySlug = new Map();
  for (const spec of HOME_CARE_SUBCATEGORIES) {
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

async function relocateMisplacedProducts() {
  const tissuesCat = await Category.findOne({ slug: 'tissues' }).select('_id').lean();
  const clothingCat = await Category.findOne({ slug: 'clothing' }).select('_id').lean();
  if (!tissuesCat || !clothingCat) return 0;

  const res = await Product.updateMany(
    {
      category: tissuesCat._id,
      name: /unstitched|lawn|embroidered|clothing|kurta|suit/i
    },
    { $set: { category: clothingCat._id, shopSubcategory: null } }
  );
  if (res.modifiedCount) {
    console.log(`  relocated ${res.modifiedCount} misplaced product(s) from tissues → clothing`);
  }
  return res.modifiedCount;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  console.log('[MongoDB] Connected');

  await relocateMisplacedProducts();

  const homeCare = await ensureCategory();
  console.log('[home-care] Category ready:', homeCare.name);

  console.log('[home-care] Seeding subcategories...');
  const subsBySlug = await seedSubcategories(homeCare._id);

  let moved = 0;
  for (const legacySlug of LEGACY_CATEGORY_SLUGS) {
    const subSlug = LEGACY_CATEGORY_TO_SUB[legacySlug];
    const sub = subsBySlug.get(subSlug);
    if (!sub) continue;

    const legacyCat = await Category.findOne({ slug: legacySlug }).select('_id name').lean();
    if (!legacyCat) continue;

    const result = await Product.updateMany(
      { category: legacyCat._id },
      { $set: { category: homeCare._id, shopSubcategory: sub._id } }
    );
    if (result.modifiedCount > 0) {
      console.log(`  moved ${result.modifiedCount} from ${legacySlug} → ${subSlug}`);
      moved += result.modifiedCount;
    }
  }

  const allInCategory = await Product.find({ category: homeCare._id }).select('name shopSubcategory').lean();
  let keywordAssigned = 0;
  for (const p of allInCategory) {
    const slug = resolveHomeCareSubcategorySlug(p.name);
    const sub = slug ? subsBySlug.get(slug) : null;
    if (!sub) continue;
    if (String(p.shopSubcategory || '') === String(sub._id)) continue;
    await Product.updateOne({ _id: p._id }, { $set: { shopSubcategory: sub._id } });
    keywordAssigned += 1;
  }
  if (keywordAssigned) console.log(`  keyword-reassigned ${keywordAssigned} products`);

  const published = await Product.updateMany(
    {
      category: homeCare._id,
      isPublished: false,
      approvalStatus: 'approved',
      images: { $elemMatch: { url: { $exists: true, $type: 'string', $nin: [''] } } }
    },
    { $set: { isPublished: true } }
  );
  console.log(`[home-care] Published ${published.modifiedCount} products`);

  await Category.updateMany({ slug: { $in: LEGACY_CATEGORY_SLUGS } }, { $set: { isActive: false } });
  console.log(`[home-care] Deactivated ${LEGACY_CATEGORY_SLUGS.length} legacy categories`);

  await syncCategoryVisibility(Category, Product);
  delByPrefix('subcategories:tree:');
  flushAll();
  invalidateCatalogCache();
  await flushRemoteApiCache();

  const final = await Category.findById(homeCare._id).lean();
  const productCount = await Product.countDocuments({ category: homeCare._id, isPublished: true });
  console.log('\nDone.');
  console.log(`  Home Care isActive: ${final.isActive}`);
  console.log(`  Published products: ${productCount}`);
  console.log(`  Total moved: ${moved}`);

  for (const spec of HOME_CARE_SUBCATEGORIES) {
    const sub = subsBySlug.get(spec.slug);
    const n = await Product.countDocuments({ category: homeCare._id, shopSubcategory: sub._id, isPublished: true });
    console.log(`    ${spec.name}: ${n}${n === 0 ? ' (admin only)' : ''}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('migrate:home-care failed:', err);
  process.exit(1);
});
