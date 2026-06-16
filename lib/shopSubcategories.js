const ProductSubcategory = require('../models/ProductSubcategory');
const Product = require('../models/Product');

const GENDER_LABELS = {
  women: 'Women',
  men: 'Men'
};

function normalizeGender(raw) {
  const g = String(raw || '')
    .trim()
    .toLowerCase();
  return g === 'women' || g === 'men' ? g : '';
}

async function resolveShopSubcategoryId(input, { categoryId, gender } = {}) {
  if (input == null || input === '') return null;
  if (typeof input === 'object' && input._id) input = input._id;

  const idStr = String(input).trim();
  if (/^[a-fA-F0-9]{24}$/.test(idStr)) {
    const row = await ProductSubcategory.findById(idStr).select('_id category gender isActive').lean();
    if (!row || !row.isActive) return null;
    if (categoryId && String(row.category) !== String(categoryId)) return null;
    if (gender && row.gender !== gender) return null;
    return row._id;
  }

  const slug = idStr.toLowerCase();
  const q = { slug, isActive: true };
  if (categoryId) q.category = categoryId;
  if (gender) q.gender = gender;
  const row = await ProductSubcategory.findOne(q).select('_id').lean();
  return row ? row._id : null;
}

async function attachSubcategoriesToProducts(docs) {
  if (!Array.isArray(docs) || !docs.length) return docs;
  const ids = [
    ...new Set(
      docs
        .map((p) => p.shopSubcategory)
        .filter(Boolean)
        .map((id) => String(id))
    )
  ];
  if (!ids.length) return docs;

  const rows = await ProductSubcategory.find({ _id: { $in: ids } })
    .select('name slug gender displayOrder')
    .lean();
  const byId = new Map(rows.map((r) => [String(r._id), r]));

  return docs.map((p) => {
    const sid = p.shopSubcategory ? String(p.shopSubcategory) : '';
    if (!sid) return p;
    const sub = byId.get(sid);
    return sub ? { ...p, shopSubcategory: sub } : { ...p, shopSubcategory: null };
  });
}

async function buildPublicSubcategoryTree(categoryId) {
  const rows = await ProductSubcategory.find({ category: categoryId, isActive: true })
    .sort({ gender: 1, displayOrder: 1, name: 1 })
    .lean();

  const counts = await Product.aggregate([
    {
      $match: {
        category: categoryId,
        isPublished: true,
        shopSubcategory: { $ne: null }
      }
    },
    { $group: { _id: '$shopSubcategory', count: { $sum: 1 } } }
  ]);
  const countMap = new Map(counts.map((r) => [String(r._id), r.count]));

  const genders = ['women', 'men'].map((gender) => ({
    gender,
    label: GENDER_LABELS[gender],
    subcategories: rows
      .filter((r) => r.gender === gender)
      .map((r) => ({
        _id: r._id,
        name: r.name,
        slug: r.slug,
        displayOrder: r.displayOrder,
        productCount: countMap.get(String(r._id)) || 0
      }))
  }));

  return genders;
}

async function countProductsBySubcategory(subcategoryId) {
  return Product.countDocuments({
    shopSubcategory: subcategoryId,
    isPublished: true
  });
}

/** When publishing clothing, gender + subcategory are required. */
async function validateClothingTaxonomyForPublish(Category, categoryId, shopGender, shopSubcategory, isPublished) {
  if (!isPublished) return null;
  const cat = await Category.findById(categoryId).select('slug').lean();
  if (!cat || cat.slug !== 'clothing') return null;

  const gender = normalizeGender(shopGender);
  if (!gender) {
    return 'Clothing products need "Shop for" (Women or Men) before publishing.';
  }
  if (!shopSubcategory) {
    return 'Clothing products need a clothing type (3 Piece, 2 Piece, etc.) before publishing.';
  }

  const sub = await ProductSubcategory.findById(shopSubcategory).select('gender isActive').lean();
  if (!sub || !sub.isActive) {
    return 'Invalid clothing type selected.';
  }
  if (sub.gender !== gender) {
    return 'Clothing type must match the selected gender (Women/Men).';
  }
  return null;
}

module.exports = {
  GENDER_LABELS,
  normalizeGender,
  resolveShopSubcategoryId,
  attachSubcategoriesToProducts,
  countProductsBySubcategory,
  buildPublicSubcategoryTree,
  validateClothingTaxonomyForPublish
};
