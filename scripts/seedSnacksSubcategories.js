/**
 * Seed Snacks & Confectionary subcategories with title-match keywords.
 * Run: npm run seed:snacks-subcategories
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

const SNACKS_SUBCATEGORIES = [
  {
    name: 'Biscuits & Wafers',
    slug: 'biscuits-wafers',
    displayOrder: 1,
    matchKeywords: [
      'biscuit',
      'biscuits',
      'wafer',
      'wafers',
      'wispy',
      'cookie',
      'cookies',
      'short bread',
      'shortbread',
      'peek freans',
      'lu gala',
      'lu prince',
      'lu zeera',
      'lu candi',
      'piper'
    ]
  },
  {
    name: 'Cakes & Rusks',
    slug: 'cakes-rusks',
    displayOrder: 2,
    matchKeywords: ['cake', 'cakes', 'kake', 'cup kake', 'bake time', 'rusk', 'rusks', 'muffin', 'muffins', 'slice']
  },
  {
    name: 'Chocolates',
    slug: 'chocolates',
    displayOrder: 3,
    matchKeywords: [
      'chocolate',
      'chocolates',
      'cocoa',
      'ferrero',
      'dairy milk',
      'kitkat',
      'sonnet',
      'bricklane',
      'candyland chocolate'
    ]
  },
  {
    name: 'Chewing Gums & Candies',
    slug: 'chewing-gums-candies',
    displayOrder: 4,
    matchKeywords: [
      'gum',
      'gums',
      'candy',
      'candies',
      'aamrus',
      'pipes',
      'toffee',
      'toffees',
      'lollipop',
      'jelly',
      'candyland now'
    ]
  },
  {
    name: 'Chips & Snacks',
    slug: 'chips-snacks',
    displayOrder: 5,
    matchKeywords: [
      'chip',
      'chips',
      "lay's",
      'lays',
      'snack',
      'snacks',
      'nimco',
      'nimko',
      'kurkure',
      'crisps',
      'popcorn',
      'pop corn',
      'korneez',
      'kernel pop',
      'kernal pop',
      'kettle pop',
      'champs mix'
    ]
  }
];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);

  const cat = await Category.findOne({ slug: 'snacks-confectionary' }).select('_id name slug').lean();
  if (!cat) {
    console.error('Category snacks-confectionary not found — run seed:categories first');
    process.exit(1);
  }

  let upserted = 0;
  for (const spec of SNACKS_SUBCATEGORIES) {
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
    upserted += 1;
    console.log('✓', spec.name);
  }

  delByPrefix('subcategories:tree:');
  invalidateCatalogCache();
  console.log(`\nSeeded ${upserted} subcategories for ${cat.name}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
