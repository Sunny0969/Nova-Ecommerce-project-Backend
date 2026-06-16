/**
 * Shared product list/query helpers — pagination, lean reads, field projection.
 */
const Category = require('../models/Category');
const Product = require('../models/Product');

/** Card/list endpoints — image, title, price, category (no description / variantAxes). */
const CARD_PRODUCT_SELECT =
  'name slug price comparePrice images category stock ratings numReviews isFeatured tags';

/** @deprecated alias */
const LIST_PRODUCT_SELECT = CARD_PRODUCT_SELECT;

/** Admin table — extra metadata, still no full HTML description. */
const ADMIN_LIST_SELECT =
  `${CARD_PRODUCT_SELECT} shortDescription isPublished approvalStatus rejectionReason sku costPrice`;

/** After $lookup category in aggregation pipelines. */
const CARD_AGG_FINAL_PROJECT = {
  _id: 1,
  name: 1,
  slug: 1,
  price: 1,
  comparePrice: 1,
  stock: 1,
  ratings: 1,
  numReviews: 1,
  isFeatured: 1,
  tags: 1,
  category: { $arrayElemAt: ['$_categoryPop', 0] },
  images: { $slice: ['$images', 1] }
};
const PUBLIC_LIST_DEFAULT_LIMIT = 20;
const PUBLIC_LIST_MAX_LIMIT = 48;
const ADMIN_LIST_DEFAULT_LIMIT = 24;
const ADMIN_LIST_MAX_LIMIT = 100;

/**
 * @param {Record<string, unknown>} query
 * @param {{ defaultLimit?: number, maxLimit?: number }} [opts]
 */
function parseProductPagination(query, opts = {}) {
  const defaultLimit = opts.defaultLimit ?? PUBLIC_LIST_DEFAULT_LIMIT;
  const maxLimit = opts.maxLimit ?? PUBLIC_LIST_MAX_LIMIT;
  const page = Math.max(1, parseInt(String(query?.page ?? ''), 10) || 1);
  const limit = Math.min(
    maxLimit,
    Math.max(1, parseInt(String(query?.limit ?? ''), 10) || defaultLimit)
  );
  const skip = (page - 1) * limit;
  return { page, limit, skip, totalPages: (total) => Math.ceil(total / limit) || 0 };
}

/**
 * Lean paginated product query with optional category populate.
 * @param {import('mongoose').FilterQuery<unknown>} filter
 * @param {{ sort?: object, skip?: number, limit?: number, select?: string, populateCategory?: boolean }} opts
 */
function findProductsLean(filter, opts = {}) {
  const {
    sort = { createdAt: -1, _id: -1 },
    skip = 0,
    limit = PUBLIC_LIST_DEFAULT_LIMIT,
    select = CARD_PRODUCT_SELECT,
    populateCategory = true
  } = opts;

  let q = Product.find(filter).sort(sort).skip(skip).limit(limit).select(select).lean();

  if (populateCategory) {
    q = q.populate('category', 'name slug');
  }

  return q;
}

function strictMongoId(v) {
  if (v == null) return false;
  return typeof v === 'string' && /^[a-fA-F0-9]{24}$/.test(v);
}

/**
 * Resolve category slug or id to a Product filter.
 * Legacy rows may store category as slug string — use $expr so Mongoose does not cast slug to ObjectId.
 * @param {string} rawCat
 * @returns {Promise<object|null>} Mongo filter fragment, empty-result filter, or null when no filter
 */
async function buildProductCategoryFilter(rawCat) {
  if (rawCat == null || String(rawCat).trim() === '' || String(rawCat).toLowerCase() === 'all') {
    return null;
  }

  const catStr = String(rawCat).trim();
  let cat = null;

  if (strictMongoId(catStr)) {
    cat = await Category.findById(catStr).select('_id slug').lean();
  } else {
    cat = await Category.findOne({ slug: catStr.toLowerCase() }).select('_id slug').lean();
  }

  if (!cat?._id) return { _id: { $in: [] } };

  const slug = String(cat.slug || catStr).toLowerCase();
  const idStr = String(cat._id);

  return {
    $or: [
      { category: cat._id },
      { $expr: { $eq: [{ $toString: '$category' }, idStr] } },
      {
        $expr: {
          $and: [
            { $eq: [{ $type: '$category' }, 'string'] },
            { $eq: [{ $toLower: '$category' }, slug] }
          ]
        }
      }
    ]
  };
}

module.exports = {
  CARD_PRODUCT_SELECT,
  LIST_PRODUCT_SELECT,
  ADMIN_LIST_SELECT,
  CARD_AGG_FINAL_PROJECT,
  PUBLIC_LIST_DEFAULT_LIMIT,
  PUBLIC_LIST_MAX_LIMIT,
  ADMIN_LIST_DEFAULT_LIMIT,
  ADMIN_LIST_MAX_LIMIT,
  parseProductPagination,
  findProductsLean,
  buildProductCategoryFilter,
  strictMongoId
};
