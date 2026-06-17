/**
 * One-time migration: single Grocery category + 15 subcategories.
 * Moves products from legacy grocery-style categories, publishes, deactivates old categories.
 *
 * Run: npm run migrate:grocery
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
  GROCERY_SUBCATEGORIES,
  LEGACY_CATEGORY_TO_SUB,
  LEGACY_CATEGORY_SLUGS,
  resolveGrocerySubcategorySlug
} = require('../lib/grocerySubcategories');
const { syncCategoryVisibility } = require('../lib/syncCategoryVisibility');
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');
const { flushAll, delByPrefix } = require('../lib/apiCache');
const { flushRemoteApiCache } = require('../lib/flushRemoteApiCache');

const GROCERY_SPEC = {
  name: 'Grocery',
  slug: 'grocery',
  description: 'Pulses, rice, flour, oils, sauces, spreads, and everyday kitchen staples',
  displayOrder: 2,
  image: {
    url: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=640&auto=format&fit=crop&q=80',
    public_id: ''
  }
};

async function ensureGroceryCategory() {
  let cat = await Category.findOneAndUpdate(
    { slug: GROCERY_SPEC.slug },
    {
      $set: {
        name: GROCERY_SPEC.name,
        slug: GROCERY_SPEC.slug,
        description: GROCERY_SPEC.description,
        displayOrder: GROCERY_SPEC.displayOrder,
        image: GROCERY_SPEC.image
      },
      $setOnInsert: { isActive: false }
    },
    { upsert: true, new: true }
  ).lean();
  return cat;
}

async function seedSubcategories(groceryId) {
  const bySlug = new Map();
  for (const spec of GROCERY_SUBCATEGORIES) {
    const row = await ProductSubcategory.findOneAndUpdate(
      { category: groceryId, gender: '', slug: spec.slug },
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

  const grocery = await ensureGroceryCategory();
  console.log('[grocery] Category ready:', grocery.name);

  console.log('[grocery] Seeding subcategories...');
  const subsBySlug = await seedSubcategories(grocery._id);

  let moved = 0;
  for (const legacySlug of LEGACY_CATEGORY_SLUGS) {
    const subSlug = LEGACY_CATEGORY_TO_SUB[legacySlug];
    const sub = subsBySlug.get(subSlug);
    if (!sub) continue;

    const legacyCat = await Category.findOne({ slug: legacySlug }).select('_id name').lean();
    if (!legacyCat) continue;

    const result = await Product.updateMany(
      { category: legacyCat._id },
      { $set: { category: grocery._id, shopSubcategory: sub._id } }
    );
    if (result.modifiedCount > 0) {
      console.log(`  moved ${result.modifiedCount} from ${legacySlug} → ${subSlug}`);
      moved += result.modifiedCount;
    }
  }

  // Keyword assign for any grocery product still missing subcategory
  const unassigned = await Product.find({
    category: grocery._id,
    $or: [{ shopSubcategory: null }, { shopSubcategory: { $exists: false } }]
  })
    .select('name')
    .lean();

  let keywordAssigned = 0;
  for (const p of unassigned) {
    const slug = resolveGrocerySubcategorySlug(p.name);
    const sub = slug ? subsBySlug.get(slug) : null;
    if (!sub) continue;
    await Product.updateOne({ _id: p._id }, { $set: { shopSubcategory: sub._id } });
    keywordAssigned += 1;
  }
  if (keywordAssigned) console.log(`  keyword-assigned ${keywordAssigned} products`);

  // Publish approved grocery products with images
  const published = await Product.updateMany(
    {
      category: grocery._id,
      isPublished: false,
      approvalStatus: 'approved',
      images: { $elemMatch: { url: { $exists: true, $type: 'string', $nin: [''] } } }
    },
    { $set: { isPublished: true } }
  );
  console.log(`[grocery] Published ${published.modifiedCount} products`);

  // Deactivate legacy standalone categories
  await Category.updateMany({ slug: { $in: LEGACY_CATEGORY_SLUGS } }, { $set: { isActive: false } });
  console.log(`[grocery] Deactivated ${LEGACY_CATEGORY_SLUGS.length} legacy categories`);

  await syncCategoryVisibility(Category, Product);
  delByPrefix('subcategories:tree:');
  flushAll();
  invalidateCatalogCache();
  await flushRemoteApiCache();

  const groceryFinal = await Category.findById(grocery._id).lean();
  const productCount = await Product.countDocuments({ category: grocery._id, isPublished: true });
  console.log('\nDone.');
  console.log(`  Grocery isActive: ${groceryFinal.isActive}`);
  console.log(`  Published products: ${productCount}`);
  console.log(`  Total moved: ${moved}`);

  for (const spec of GROCERY_SUBCATEGORIES) {
    const sub = subsBySlug.get(spec.slug);
    const n = await Product.countDocuments({ category: grocery._id, shopSubcategory: sub._id, isPublished: true });
    if (n > 0) console.log(`    ${spec.name}: ${n}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('migrate:grocery failed:', err);
  process.exit(1);
});
