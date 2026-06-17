/**
 * Seed Tea & Coffee subcategories.
 * Run: npm run seed:tea-coffee-subcategories
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Category = require('../models/Category');
const ProductSubcategory = require('../models/ProductSubcategory');
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');
const { delByPrefix } = require('../lib/apiCache');

const TEA_COFFEE_SUBCATEGORIES = [
  {
    name: 'Tea',
    slug: 'tea',
    displayOrder: 1,
    matchKeywords: [
      'green tea',
      'black tea',
      'tea bags',
      "tea bag",
      'tapal green',
      'tapal tea',
      'lipton',
      'tea jar',
      'gulbahar'
    ]
  },
  {
    name: 'Coffee',
    slug: 'coffee',
    displayOrder: 2,
    matchKeywords: ['coffee', 'nescafe', 'nescafé', 'imtiaz coffee', 'gold blend', 'classic coffee']
  },
  {
    name: 'Instant Tea & Coffee',
    slug: 'instant-tea-coffee',
    displayOrder: 3,
    matchKeywords: [
      '3in1',
      '3 in 1',
      'sachet',
      'instant tea',
      'instant coffee',
      'blend & brew',
      'danedar 3in1'
    ]
  },
  {
    name: 'Tea Whiteners',
    slug: 'tea-whiteners',
    displayOrder: 4,
    matchKeywords: [
      'whitener',
      'tea whitener',
      'everyday tea whitener',
      'tea millac',
      'dairy omung',
      'mixed tea'
    ]
  }
];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);

  const cat = await Category.findOne({ slug: 'tea-coffee' }).select('_id name slug').lean();
  if (!cat) {
    console.error('Category tea-coffee not found — run seed:categories first');
    process.exit(1);
  }

  for (const spec of TEA_COFFEE_SUBCATEGORIES) {
    await ProductSubcategory.findOneAndUpdate(
      { category: cat._id, gender: '', slug: spec.slug },
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
    );
    console.log('✓', spec.name);
  }

  delByPrefix('subcategories:tree:');
  invalidateCatalogCache();
  console.log(`\nSeeded ${TEA_COFFEE_SUBCATEGORIES.length} subcategories for ${cat.name}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
