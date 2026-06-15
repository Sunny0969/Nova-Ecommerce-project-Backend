const Category = require('../models/Category');

/** Storefront-visible category ids (isActive: true). */
async function activeCategoryIds() {
  const rows = await Category.find({ isActive: true }).select('_id').lean();
  return rows.map((r) => r._id);
}

/** Mongo filter: product.category must belong to an active category. */
async function activeCategoryProductFilter() {
  const ids = await activeCategoryIds();
  if (!ids.length) return { _id: { $in: [] } };
  return { category: { $in: ids } };
}

module.exports = { activeCategoryIds, activeCategoryProductFilter };
