/**
 * Assign products to subcategories by category slug (title rules). Unmatched products are left without subcategory.
 */
const { resolveCategorySubcategorySlug } = require('./shopSubcategories');
const ProductSubcategory = require('../models/ProductSubcategory');
const Product = require('../models/Product');
const { invalidateCatalogCache } = require('./invalidatePublicCache');
const { delByPrefix } = require('./apiCache');

/**
 * @param {object} opts
 * @param {string} opts.categorySlug
 * @param {boolean} [opts.publishedOnly=true]
 */
async function assignCategorySubcategories({ categorySlug, publishedOnly = true }) {
  const Category = require('../models/Category');
  const cat = await Category.findOne({ slug: categorySlug }).select('_id name').lean();
  if (!cat) {
    throw new Error(`Category not found: ${categorySlug}`);
  }

  const subs = await ProductSubcategory.find({ category: cat._id, gender: '' }).lean();
  const bySlug = new Map(subs.map((s) => [s.slug, s]));

  const productQuery = { category: cat._id };
  if (publishedOnly) productQuery.isPublished = true;

  const products = await Product.find(productQuery).select('name shopSubcategory').lean();

  let assigned = 0;
  let skipped = 0;
  const counts = {};

  for (const p of products) {
    const slug = resolveCategorySubcategorySlug(categorySlug, p.name);
    const sub = slug ? bySlug.get(slug) : null;
    if (!sub) {
      skipped += 1;
      continue;
    }
    if (String(p.shopSubcategory || '') !== String(sub._id)) {
      await Product.updateOne({ _id: p._id }, { $set: { shopSubcategory: sub._id } });
      assigned += 1;
    }
    counts[slug] = (counts[slug] || 0) + 1;
  }

  delByPrefix('subcategories:tree:');
  invalidateCatalogCache();

  return {
    category: cat.name,
    categorySlug,
    assigned,
    skipped,
    counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0)
  };
}

module.exports = { assignCategorySubcategories };
