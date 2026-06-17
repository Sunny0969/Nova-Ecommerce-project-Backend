/**
 * Seed Beverages subcategories with title-match keywords.
 * Run: npm run seed:beverages-subcategories
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

const BEVERAGES_SUBCATEGORIES = [
  {
    name: 'Carbonated Soft Drinks',
    slug: 'carbonated-soft-drinks',
    displayOrder: 1,
    matchKeywords: [
      'murree',
      'malt',
      'float',
      'cola',
      'pepsi',
      '7up',
      'sprite',
      'fanta',
      'soda',
      'sparkling',
      'carbonated',
      'soft drink'
    ]
  },
  {
    name: 'Juices & Nectars',
    slug: 'juices-nectars',
    displayOrder: 2,
    matchKeywords: [
      'juice',
      'nectar',
      'fruit drink',
      'coconut water',
      'slice',
      'maza',
      'quice',
      'haleeb fruit',
      'gold nectar'
    ]
  },
  {
    name: 'Sports Drink',
    slug: 'sports-drink',
    displayOrder: 3,
    matchKeywords: ['sports drink', 'sport drink', 'gatorade', 'powerade', 'staminade', 'electrolyte']
  },
  {
    name: 'Make to Drink',
    slug: 'make-to-drink',
    displayOrder: 4,
    matchKeywords: ['make to drink', 'tang', 'instant drink', 'drink mix', 'powder sachet', 'sachet drink']
  },
  {
    name: 'Water',
    slug: 'water',
    displayOrder: 5,
    matchKeywords: ['mineral water', 'aquafina', 'dasani', 'masafi', 'nestle mineral', 'drinking water']
  }
];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);

  const cat = await Category.findOne({ slug: 'beverages' }).select('_id name slug').lean();
  if (!cat) {
    console.error('Category beverages not found — run seed:categories first');
    process.exit(1);
  }

  for (const spec of BEVERAGES_SUBCATEGORIES) {
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
  console.log(`\nSeeded ${BEVERAGES_SUBCATEGORIES.length} subcategories for ${cat.name}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
