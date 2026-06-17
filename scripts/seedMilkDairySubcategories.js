/**
 * Seed Milk & Dairy subcategories.
 * Run: npm run seed:milk-dairy-subcategories
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

const MILK_DAIRY_SUBCATEGORIES = [
  {
    name: 'Milk',
    slug: 'milk',
    displayOrder: 1,
    matchKeywords: [
      'full cream milk',
      'powder milk',
      'condensed milk',
      'lactose free',
      'dairy omung',
      'nesvita',
      'millac',
      'nurpur',
      'haleeb',
      "olper's",
      'olpers',
      'good milk',
      'comelle',
      'dairy king',
      ' milk '
    ]
  },
  {
    name: 'Flavoured Milk',
    slug: 'flavoured-milk',
    displayOrder: 2,
    matchKeywords: [
      'flavour milk',
      'flavor milk',
      'flavoured milk',
      'flavored milk',
      'pakola milk',
      'milo drink',
      'strawberry milk',
      'chocolate milk',
      'mango milk',
      'zafran',
      'zafrani',
      'salted caramel',
      'pistachio'
    ]
  },
  {
    name: 'Chilled Coffee',
    slug: 'chilled-coffee',
    displayOrder: 3,
    matchKeywords: [
      'chilled coffee',
      'iced coffee',
      'cold coffee',
      'coffee drink',
      'bottled coffee',
      'mocha',
      'latte',
      'frappe',
      'cappuccino'
    ]
  },
  {
    name: 'Butter & Margarine',
    slug: 'butter-margarine',
    displayOrder: 4,
    matchKeywords: ['butter', 'margarine', 'blue band', 'olive spread', 'unsalted butter']
  },
  {
    name: 'Yogurt',
    slug: 'yogurt',
    displayOrder: 5,
    matchKeywords: ['yogurt', 'yoghurt', 'dahi', 'lassi', 'raita', 'curd', 'laban', 'sour cream']
  }
];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);

  const cat = await Category.findOne({ slug: 'milk-dairy' }).select('_id name slug').lean();
  if (!cat) {
    console.error('Category milk-dairy not found — run seed:categories first');
    process.exit(1);
  }

  for (const spec of MILK_DAIRY_SUBCATEGORIES) {
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
  console.log(`\nSeeded ${MILK_DAIRY_SUBCATEGORIES.length} subcategories for ${cat.name}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
