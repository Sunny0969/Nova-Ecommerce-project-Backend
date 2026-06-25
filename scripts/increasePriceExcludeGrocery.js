/**
 * Increase selling price (product.price + variant option prices) by a percentage,
 * excluding products in the Grocery category.
 *
 * Run: node scripts/increasePriceExcludeGrocery.js
 * Optional: PERCENT=5 node scripts/increasePriceExcludeGrocery.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { buildProductCategoryFilter } = require('../lib/productQueries');
const { computeAdjustedValue } = require('../lib/bulkProductAdjust');
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');

const PERCENT = Number(process.env.PERCENT) || 5;
const AXES = ['color', 'shape', 'size'];

function bumpVariantAxesPrices(variantAxes, adjustment) {
  if (!variantAxes || typeof variantAxes !== 'object') return variantAxes;
  const next = JSON.parse(JSON.stringify(variantAxes));
  let changed = false;

  for (const axis of AXES) {
    const ax = next[axis];
    if (!ax?.options?.length) continue;
    for (const opt of ax.options) {
      if (opt.price == null || opt.price === '') continue;
      const bumped = computeAdjustedValue(opt.price, adjustment);
      if (bumped != null && Number(bumped) !== Number(opt.price)) {
        opt.price = bumped;
        changed = true;
      }
    }
  }

  return changed ? next : null;
}

async function main() {
  const percent = PERCENT;
  if (!Number.isFinite(percent) || percent <= 0) {
    throw new Error('PERCENT must be a positive number');
  }

  const adjustment = {
    field: 'price',
    mode: 'percent',
    direction: 'increase',
    value: percent
  };

  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);

  const grocery = await Category.findOne({ slug: 'grocery' }).select('_id slug name').lean();
  if (!grocery) {
    console.warn('No Grocery category found — will adjust ALL products.');
  } else {
    console.log(`Excluding category: ${grocery.name} (${grocery.slug})`);
  }

  const groceryFilter = grocery ? await buildProductCategoryFilter('grocery') : null;
  const query = groceryFilter ? { $nor: [groceryFilter] } : {};

  const products = await Product.find(query).select('_id name price variantAxes category').lean();
  console.log(`Matched ${products.length} non-grocery products`);

  const ops = [];
  let priceUpdates = 0;
  let variantUpdates = 0;

  for (const p of products) {
    const $set = {};
    const nextPrice = computeAdjustedValue(p.price, adjustment);
    if (nextPrice != null && Number(nextPrice) !== Number(p.price ?? 0)) {
      $set.price = nextPrice;
      priceUpdates += 1;
    }

    const nextAxes = bumpVariantAxesPrices(p.variantAxes, adjustment);
    if (nextAxes) {
      $set.variantAxes = nextAxes;
      variantUpdates += 1;
    }

    if (Object.keys($set).length) {
      ops.push({
        updateOne: {
          filter: { _id: p._id },
          update: { $set }
        }
      });
    }
  }

  if (!ops.length) {
    console.log('No price changes needed.');
    await mongoose.disconnect();
    return;
  }

  const r = await Product.bulkWrite(ops, { ordered: false });
  invalidateCatalogCache();

  console.log(`Done: +${percent}% selling price`);
  console.log(`  Products updated: ${r.modifiedCount}`);
  console.log(`  Base price rows: ${priceUpdates}`);
  console.log(`  Variant price rows: ${variantUpdates}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
