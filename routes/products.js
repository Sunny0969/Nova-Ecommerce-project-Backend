const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Brand = require('../models/Brand');
const Review = require('../models/Review');
const StockNotification = require('../models/StockNotification');
const Order = require('../models/Order');
const User = require('../models/User');
const requireAdmin = require('../middleware/requireAdmin');
const { adminOrStaffPermission } = require('../middleware/staffAuth');
const { requireJwtAuth, attachJwtUserSilent } = require('../middleware/jwtAuth');
const { uploadImageBuffer, deleteByPublicId } = require('../lib/cloudinary');
const {
  sanitizeVariantAxes,
  parseVariantAxesFromBodyField,
  variantAxesToLegacyFlat,
  diffPublicIdsToRemove,
  mergeVariantOptionUploads
} = require('../lib/variantAxes');
const { productNameQueryForBrand } = require('../lib/brandFilters');
const { queueProductEmbeddingUpdate, hybridSearch, suggestQueries } = require('../services/aiSearch');
const { logSearchQuery, logSearchClick, getTrendingSearches } = require('../services/searchAnalytics');
const { saleProductMatchFilter } = require('../lib/productSale');
const { sanitizeProductDoc } = require('../lib/productDescription');
const { productHasImageMongoMatch, productHasValidImage } = require('../lib/productImageFilter');
const { getFakeDisplayRating, parseMinRatingFilter } = require('../lib/fakeReviews');
const {
  CARD_PRODUCT_SELECT,
  CARD_AGG_FINAL_PROJECT,
  parseProductPagination,
  findProductsLean
} = require('../lib/productQueries');
const { shapeProductListItem } = require('../lib/productListShape');
const { getOrSet, CACHE_KEYS } = require('../lib/apiCache');
const { setPublicApiCacheHeaders } = require('../lib/publicApiCacheHeaders');
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  /** Large admin product saves: many images + long `description` (incl. base64). */
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 64,
    fieldSize: 100 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const isMain = file.fieldname === 'images' || file.fieldname === 'image';
    const isVariant = /^variantOptionImage_(color|shape|size)_\d+$/.test(file.fieldname);
    if (isMain || isVariant) {
      if (!file.mimetype.startsWith('image/')) {
        return cb(new Error('Only image uploads are allowed'));
      }
    }
    cb(null, true);
  }
});

function ok(res, data, status = 200, extra = {}) {
  res.status(status).json({ success: true, data, ...extra });
}

function fail(res, status, message, errors = undefined) {
  const body = { success: false, message };
  if (errors && Object.keys(errors).length) body.errors = errors;
  res.status(status).json(body);
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** List/search filter — regex on `name` (uses name / category+name indexes). */
function productSearchFilter(q) {
  const raw = String(q || '').trim();
  if (!raw) return null;

  const terms = raw.split(/\s+/).filter(Boolean).slice(0, 6);
  if (!terms.length) return null;

  if (terms.length === 1) {
    return { name: new RegExp(escapeRegex(terms[0]), 'i') };
  }

  return {
    $and: terms.map((term) => ({ name: new RegExp(escapeRegex(term), 'i') }))
  };
}

function shapeProductDoc(doc) {
  const d =
    doc && typeof doc.toObject === 'function'
      ? doc.toObject({ virtuals: true })
      : doc;
  const firstImg = d.images?.[0]?.url || '';
  let categorySlug =
    typeof d.category === 'object' && d.category?.slug
      ? d.category.slug
      : null;
  if (!categorySlug && typeof d.category === 'string') {
    categorySlug = d.category;
  }

  const stock = Number(d.stock);
  const stockQuantity = Number.isFinite(stock) ? Math.max(0, Math.floor(stock)) : 0;

  const price = Number(d.price);
  const comparePrice =
    d.comparePrice != null ? Number(d.comparePrice) : undefined;

  let badge = '';
  if (d.isFeatured) badge = 'bestseller';

  const cleanedDesc = sanitizeProductDoc({
    shortDescription: d.shortDescription || '',
    description: d.description || '',
    name: d.name || '',
    slug: d.slug || ''
  });

  return {
    _id: d._id,
    productId: d.slug,
    slug: d.slug,
    name: cleanedDesc.name,
    category: categorySlug || 'fashion',
    price: Number.isFinite(price) ? price : 0,
    comparePrice: Number.isFinite(comparePrice) ? comparePrice : undefined,
    originalPrice: Number.isFinite(comparePrice) ? comparePrice : undefined,
    isOnSale:
      Number.isFinite(comparePrice) &&
      Number.isFinite(price) &&
      comparePrice > price &&
      comparePrice > 0,
    emoji: '📦',
    imageUrl: firstImg,
    images: Array.isArray(d.images) ? d.images : [],
    description: cleanedDesc.description,
    shortDescription: cleanedDesc.shortDescription,
    stockQuantity,
    rating: Number.isFinite(Number(d.ratings)) ? Number(d.ratings) : 0,
    ratingCount: Number.isFinite(Number(d.numReviews)) ? Number(d.numReviews) : 0,
    badge,
    inStock: stockQuantity > 0,
    isFeatured: Boolean(d.isFeatured),
    isPublished: Boolean(d.isPublished),
    approvalStatus: d.approvalStatus || 'approved',
    rejectionReason: d.rejectionReason || '',
    discountPercentage: d.discountPercentage,
    tags: Array.isArray(d.tags) ? d.tags : [],
    sku: d.sku != null && String(d.sku).trim() ? String(d.sku).trim() : undefined,
    color: d.color != null && String(d.color).trim() ? String(d.color).trim() : undefined,
    texture: d.texture != null && String(d.texture).trim() ? String(d.texture).trim() : undefined,
    size: d.size != null && String(d.size).trim() ? String(d.size).trim() : undefined,
    weight: d.weight != null && String(d.weight).trim() ? String(d.weight).trim() : undefined,
    weightKg:
      d.weightKg != null && Number.isFinite(Number(d.weightKg)) && Number(d.weightKg) >= 0
        ? Number(d.weightKg)
        : undefined,
    variantGroupKey:
      d.variantGroupKey != null && String(d.variantGroupKey).trim()
        ? String(d.variantGroupKey).trim()
        : undefined,
    variantAxes: sanitizeVariantAxes(d.variantAxes || {}),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt
  };
}

function formatMongooseValidation(err) {
  const errors = {};
  if (err.errors) {
    for (const key of Object.keys(err.errors)) {
      errors[key] = err.errors[key].message;
    }
  }
  return errors;
}

async function resolveCategoryId(input) {
  if (!input) return null;
  if (typeof input === 'string' && /^[a-fA-F0-9]{24}$/.test(input.trim())) {
    const byId = await Category.findById(input.trim()).select('_id');
    if (byId) return byId._id;
  }
  const slug = String(input).trim().toLowerCase();
  const cat = await Category.findOne({ slug }).select('_id');
  return cat ? cat._id : null;
}

const { recalculateProductRatings } = require('../utils/recalculateProductRatings');
const { generateFakeReviewsForProduct } = require('../utils/generateFakeReviews');

async function hasDeliveredPurchase(userId, productId) {
  return Order.exists({
    user: userId,
    isDelivered: true,
    orderItems: { $elemMatch: { product: productId } }
  });
}

async function deleteProductImagesFromCloudinary(images) {
  if (!images?.length) return;
  for (const img of images) {
    if (img?.public_id) {
      try {
        await deleteByPublicId(img.public_id);
      } catch (e) {
        console.warn('Cloudinary delete:', e.message);
      }
    }
  }
}

async function buildListFilter(query) {
  const {
    category,
    minPrice,
    maxPrice,
    search,
    featured,
    inStock,
    onSale
  } = query;

  const and = [{ isPublished: true }, productHasImageMongoMatch()];

  const q = String(search || '').trim();
  if (q) {
    const searchFilter = productSearchFilter(q);
    if (searchFilter) and.push(searchFilter);
  }

  const rawCats = category;
  const slugList = (() => {
    if (rawCats == null || rawCats === '' || rawCats === 'all') return [];
    if (Array.isArray(rawCats)) {
      return rawCats
        .map((s) => String(s).trim().toLowerCase())
        .filter((s) => s && s !== 'all');
    }
    const one = String(rawCats).trim().toLowerCase();
    if (!one || one === 'all') return [];
    if (one.includes(',')) {
      return one
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    }
    return [one];
  })();

  if (slugList.length === 1) {
    const cat = await Category.findOne({ slug: slugList[0] }).select('_id').lean();
    if (!cat) {
      and.push({ _id: { $in: [] } });
    } else {
      and.push({ category: cat._id });
    }
  } else if (slugList.length > 1) {
    const cats = await Category.find({ slug: { $in: slugList } }).select('_id').lean();
    const ids = cats.map((c) => c._id);
    if (!ids.length) {
      and.push({ _id: { $in: [] } });
    } else {
      and.push({ category: { $in: ids } });
    }
  }

  const mp =
    minPrice !== undefined && minPrice !== '' ? parseFloat(minPrice) : NaN;
  const xp =
    maxPrice !== undefined && maxPrice !== '' ? parseFloat(maxPrice) : NaN;
  if (Number.isFinite(mp) || Number.isFinite(xp)) {
    const range = {};
    if (Number.isFinite(mp)) range.$gte = mp;
    if (Number.isFinite(xp)) range.$lte = xp;
    and.push({ price: range });
  }

  const brandSlug = String(query.brand || '')
    .trim()
    .toLowerCase();
  if (brandSlug) {
    const brandDoc = await Brand.findOne({ slug: brandSlug, isActive: true })
      .select('name')
      .lean();
    if (!brandDoc) {
      and.push({ _id: { $in: [] } });
    } else {
      const brandNameFilter = productNameQueryForBrand(brandDoc.name);
      if (brandNameFilter) and.push(brandNameFilter);
    }
  }

  // Rating filter uses display ratings (see GET / handler + fakeReviews.js).

  if (featured === 'true' || featured === true) {
    and.push({ isFeatured: true });
    }

    if (inStock === 'true') {
    and.push({ stock: { $gt: 0 } });
  }

  const tag = String(query.tag || '').trim();
  if (tag) {
    and.push({ tags: tag });
  }

  if (onSale === 'true' || onSale === true) {
    const saleParts = saleProductMatchFilter();
    delete saleParts.isPublished;
    and.push(saleParts);
  }

  return { $and: and };
}

function buildListSort(sortParam) {
  switch (sortParam) {
    case 'price-asc':
      return { price: 1, _id: 1 };
    case 'price-desc':
      return { price: -1, _id: -1 };
    case 'rating':
      return { ratings: -1, numReviews: -1, _id: -1 };
    case 'popular':
      return { numReviews: -1, ratings: -1, createdAt: -1 };
    case 'name':
      return { name: 1, _id: 1 };
    case 'newest':
    default:
      return { createdAt: -1, _id: -1 };
  }
}

/**
 * GET /api/products — paginated list + filters + name search
 */
router.get('/', async (req, res) => {
  try {
    const { page, limit, skip, totalPages } = parseProductPagination(req.query);
    const sort = buildListSort(req.query.sort);
    const minDisplayRating = parseMinRatingFilter(req.query.rating);

    let filter = await buildListFilter(req.query);

    if (minDisplayRating != null) {
      const baseFilter = await buildListFilter({ ...req.query, rating: undefined });
      const candidates = await Product.find(baseFilter).select('_id slug name').lean();
      const matchingIds = candidates
        .filter((p) => getFakeDisplayRating(p) >= minDisplayRating)
        .map((p) => p._id);

      if (!matchingIds.length) {
        return ok(res, {
          products: [],
          totalCount: 0,
          totalPages: 0,
          currentPage: page
        });
      }

      filter = { $and: [...baseFilter.$and, { _id: { $in: matchingIds } }] };
    }

    const [raw, totalCount] = await Promise.all([
      findProductsLean(filter, { sort, skip, limit }),
      Product.countDocuments(filter)
    ]);

    ok(res, {
      products: raw.map(shapeProductListItem),
      totalCount,
      totalPages: totalPages(totalCount),
      currentPage: page
    });
  } catch (error) {
    console.error('Get products error:', error);
    fail(res, 500, error.message || 'Failed to fetch products');
  }
});

/**
 * GET /api/products/home-category-sales — recent categories with on-sale products (homepage rows)
 */
router.get('/home-category-sales', async (req, res) => {
  try {
    const categoryLimit = Math.min(10, Math.max(1, parseInt(req.query.categories, 10) || 5));
    const productLimit = Math.min(20, Math.max(1, parseInt(req.query.productsPerCategory, 10) || 12));
    const cacheKey = CACHE_KEYS.homeCategorySales(categoryLimit, productLimit);

    const { value: payload, hit } = await getOrSet(cacheKey, async () => {
      const categoryRows = await Product.aggregate([
        { $match: saleProductMatchFilter() },
        {
          $group: {
            _id: '$category',
            saleCount: { $sum: 1 },
            latestSaleAt: { $max: '$createdAt' }
          }
        },
        {
          $lookup: {
            from: 'categories',
            localField: '_id',
            foreignField: '_id',
            as: '_cat'
          }
        },
        { $unwind: '$_cat' },
        { $match: { '_cat.isActive': { $ne: false } } },
        { $sort: { '_cat.updatedAt': -1, latestSaleAt: -1 } },
        { $limit: categoryLimit },
        {
          $project: {
            categoryId: '$_id',
            name: '$_cat.name',
            slug: '$_cat.slug',
            saleCount: 1
          }
        }
      ]);

      if (!categoryRows.length) {
        return { rows: [] };
      }

      const rows = (
        await Promise.all(
          categoryRows.map(async (row) => {
            const raw = await Product.aggregate([
              {
                $match: {
                  ...saleProductMatchFilter(),
                  category: row.categoryId
                }
              },
              {
                $addFields: {
                  _saleDiscountPct: {
                    $multiply: [
                      {
                        $divide: [{ $subtract: ['$comparePrice', '$price'] }, '$comparePrice']
                      },
                      100
                    ]
                  }
                }
              },
              { $sort: { _saleDiscountPct: -1, createdAt: -1 } },
              { $limit: productLimit },
              {
                $lookup: {
                  from: 'categories',
                  localField: 'category',
                  foreignField: '_id',
                  as: '_categoryPop'
                }
              },
              {
                $addFields: {
                  category: { $arrayElemAt: ['$_categoryPop', 0] }
                }
              },
              { $project: CARD_AGG_FINAL_PROJECT }
            ]);

            return {
              category: {
                _id: row.categoryId,
                name: row.name,
                slug: row.slug,
                saleCount: row.saleCount
              },
              products: raw.map(shapeProductListItem)
            };
          })
        )
      ).filter((row) => row.products.length > 0);

      return { rows };
    });

    setPublicApiCacheHeaders(res, { hit });
    ok(res, payload);
  } catch (error) {
    console.error('Home category sales error:', error);
    fail(res, 500, error.message || 'Failed to fetch category sale rows');
  }
});

/**
 * GET /api/products/flash-sale — published products with comparePrice > price
 */
router.get('/flash-sale', async (req, res) => {
  try {
    const limit = Math.min(64, Math.max(1, parseInt(req.query.limit, 10) || 32));
    const cacheKey = CACHE_KEYS.productsFlashSale(limit);
    const { value: shaped, hit } = await getOrSet(cacheKey, async () => {
      const raw = await Product.aggregate([
        { $match: saleProductMatchFilter() },
        {
          $addFields: {
            _saleDiscountPct: {
              $multiply: [
                {
                  $divide: [{ $subtract: ['$comparePrice', '$price'] }, '$comparePrice']
                },
                100
              ]
            }
          }
        },
        { $sort: { _saleDiscountPct: -1, createdAt: -1 } },
        { $limit: limit },
        {
          $lookup: {
            from: 'categories',
            localField: 'category',
            foreignField: '_id',
            as: '_categoryPop'
          }
        },
        { $project: CARD_AGG_FINAL_PROJECT }
      ]);
      return raw.map(shapeProductListItem);
    });

    setPublicApiCacheHeaders(res, { hit });
    ok(res, shaped);
  } catch (error) {
    console.error('Flash sale products error:', error);
    fail(res, 500, error.message || 'Failed to fetch flash sale products');
  }
});

/**
 * GET /api/products/featured — published + featured, limit 8
 */
router.get('/featured', async (req, res) => {
  try {
    const { value: shaped, hit } = await getOrSet(CACHE_KEYS.PRODUCTS_FEATURED, async () => {
      const raw = await Product.find({
        isPublished: true,
        isFeatured: true,
        ...productHasImageMongoMatch()
      })
        .select(CARD_PRODUCT_SELECT)
        .sort({ createdAt: -1 })
        .limit(8)
        .populate('category', 'name slug')
        .lean();
      return raw.map(shapeProductListItem);
    });

    setPublicApiCacheHeaders(res, { hit });
    ok(res, shaped);
  } catch (error) {
    console.error('Featured products error:', error);
    fail(res, 500, error.message || 'Failed to fetch featured products');
  }
});

/**
 * GET /api/products/search?q= — autocomplete: name + slug only
 */
router.get('/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 1) {
      return ok(res, []);
    }

    const rx = new RegExp(escapeRegex(q), 'i');
    const rows = await Product.find({
      isPublished: true,
      name: rx,
      ...productHasImageMongoMatch()
    })
      .select('name slug')
      .sort({ name: 1 })
      .limit(12)
      .lean();

    ok(
      res,
      rows.map((p) => ({ name: p.name, slug: p.slug }))
    );

    // fire-and-forget analytics (autocomplete keyword search)
    logSearchQuery(req, {
      query: q,
      resultsCount: rows.length,
      source: 'autocomplete'
    }).catch(() => {});
  } catch (error) {
    console.error('Product search autocomplete error:', error);
    fail(res, 500, error.message || 'Search failed');
  }
});

/**
 * GET /api/products/trending-searches — popular queries (analytics)
 */
router.get('/trending-searches', async (req, res) => {
  try {
    const days = req.query.days;
    const limit = req.query.limit;
    const rows = await getTrendingSearches({ days, limit });
    ok(res, rows);
  } catch (error) {
    console.error('Trending searches error:', error);
    fail(res, 500, error.message || 'Failed to load trending searches');
  }
});

/**
 * POST /api/products/search-click — analytics click tracking
 * body: { query, productId, source }
 */
router.post('/search-click', attachJwtUserSilent, async (req, res) => {
  try {
    const query = req.body?.query;
    const productId = req.body?.productId;
    const source = req.body?.source;
    await logSearchClick(req, { query, productId, source: source || 'ui' });
    ok(res, { logged: true });
  } catch (error) {
    fail(res, 500, error.message || 'Failed to log click');
  }
});

/**
 * GET /api/products/ai-suggest?q= — optional AI query rewrites
 */
router.get('/ai-suggest', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return ok(res, []);
    const suggestions = await suggestQueries({ query: q, max: 3 });
    ok(res, suggestions);
  } catch (error) {
    console.error('AI suggest error:', error);
    ok(res, []); // suggestions are optional; never fail the UI
  }
});

/**
 * GET /api/products/ai-search?q=
 * Hybrid: 60% semantic + 40% keyword.
 */
router.get('/ai-search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 1) return ok(res, { products: [] });

    const result = await hybridSearch({ query: q, limit: 10, semanticWeight: 0.6, keywordWeight: 0.4 });
    const ids = result.items.map((x) => x.productId).filter(Boolean);
    const rows = ids.length
      ? await Product.find({ _id: { $in: ids }, isPublished: true, ...productHasImageMongoMatch() })
          .select(CARD_PRODUCT_SELECT)
          .populate('category', 'name slug')
          .lean()
      : [];
    const byId = new Map(rows.map((r) => [String(r._id), r]));
    const ordered = ids.map((id) => byId.get(String(id))).filter(Boolean);

    // analytics (non-blocking)
    logSearchQuery(req, { query: q, resultsCount: ordered.length, source: 'ai-search' }).catch(() => {});

    ok(res, {
      products: ordered.map(shapeProductListItem),
      debug:
        process.env.NODE_ENV === 'development'
          ? { scores: result.items }
          : undefined
    });
  } catch (error) {
    console.error('AI search error:', error);
    fail(res, 500, error.message || 'AI search failed');
  }
});

/**
 * GET /api/products/category-tags?category=baby-care
 * Distinct subcategory tags for products in one category (shop filter chips).
 */
router.get('/category-tags', async (req, res) => {
  try {
    const categorySlug = String(req.query.category || '')
      .trim()
      .toLowerCase();
    if (!categorySlug) {
      return ok(res, []);
    }

    const cat = await Category.findOne({ slug: categorySlug, isActive: true }).select(
      '_id'
    );
    if (!cat) {
      return ok(res, []);
    }

    const rows = await Product.aggregate([
      {
        $match: {
          isPublished: true,
          category: cat._id,
          tags: { $exists: true, $type: 'array', $ne: [] }
        }
      },
      { $unwind: '$tags' },
      {
        $match: {
          tags: { $type: 'string', $ne: '' }
        }
      },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    ok(
      res,
      rows.map((r) => ({ tag: r._id, count: r.count }))
    );
  } catch (error) {
    console.error('Category tags error:', error);
    fail(res, 500, error.message || 'Failed to load category tags');
  }
});

function parseMultipartBody(req) {
  const b = req.body || {};
  const num = (v, d) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : d;
  };
  const int = (v, d) => {
    const n = parseInt(v, 10);
    return Number.isInteger(n) ? n : d;
  };
  return {
    name: b.name != null ? String(b.name).trim() : '',
    category: b.category,
    price: num(b.price, NaN),
    stock: int(b.stock, NaN),
    description: b.description != null ? String(b.description) : '',
    shortDescription:
      b.shortDescription != null ? String(b.shortDescription) : '',
    comparePrice:
      b.comparePrice !== undefined && b.comparePrice !== ''
        ? num(b.comparePrice, null)
        : null,
    costPrice:
      b.costPrice !== undefined && b.costPrice !== '' ? num(b.costPrice, null) : null,
    sku: b.sku != null ? String(b.sku).trim() : '',
    tags: (() => {
      if (!b.tags) return [];
      if (Array.isArray(b.tags)) return b.tags.map(String);
      if (typeof b.tags === 'string') {
        try {
          const t = JSON.parse(b.tags || '[]');
          return Array.isArray(t) ? t.map(String) : [];
        } catch {
          return [];
        }
      }
      return [];
    })(),
    isFeatured: b.isFeatured === true || b.isFeatured === 'true',
    isPublished:
      b.isPublished === undefined ||
      b.isPublished === true ||
      b.isPublished === 'true',
    lowStockThreshold: (() => {
      if (b.lowStockThreshold === undefined) return undefined;
      if (b.lowStockThreshold === '' || b.lowStockThreshold === null) return null;
      const n = int(b.lowStockThreshold, NaN);
      return Number.isInteger(n) && n >= 0 ? n : null;
    })(),
    slug: (() => {
      if (b.slug === undefined) return undefined;
      if (b.slug == null || String(b.slug).trim() === '') return null;
      return String(b.slug)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/[0-9]+/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    })(),
    color: b.color !== undefined ? String(b.color ?? '').trim().slice(0, 120) : undefined,
    texture: b.texture !== undefined ? String(b.texture ?? '').trim().slice(0, 120) : undefined,
    size: b.size !== undefined ? String(b.size ?? '').trim().slice(0, 120) : undefined,
    weight: b.weight !== undefined ? String(b.weight ?? '').trim().slice(0, 120) : undefined,
    weightKg: (() => {
      if (b.weightKg === undefined) return undefined;
      if (b.weightKg === '' || b.weightKg === null) return null;
      const n = Number(b.weightKg);
      return Number.isFinite(n) && n >= 0 ? n : null;
    })(),
    variantGroupKey:
      b.variantGroupKey !== undefined
        ? String(b.variantGroupKey ?? '').trim().slice(0, 120)
        : undefined,
    variantAxes: (() => {
      if (!Object.prototype.hasOwnProperty.call(b, 'variantAxes')) return undefined;
      return parseVariantAxesFromBodyField(b.variantAxes);
    })()
  };
}

/**
 * POST /api/products — admin create, multiple images → Cloudinary, slug from name
 */
router.post(
  '/',
  ...adminOrStaffPermission('manageProducts'),
  upload.any(),
  async (req, res) => {
    try {
      const parsed = parseMultipartBody(req);
      const errors = {};

      const files = Array.isArray(req.files) ? req.files : [];
      for (const f of files) {
        if (f.fieldname === 'images' || /^variantOptionImage_(color|shape|size)_\d+$/.test(f.fieldname)) continue;
        if (f.buffer && f.buffer.length) {
          errors.files = `Unexpected file field: ${f.fieldname}`;
          break;
        }
      }
      if (errors.files) {
        return fail(res, 400, 'Validation failed', errors);
      }

      const mainImages = files.filter((f) => f.fieldname === 'images');

      if (!parsed.name) errors.name = 'Required';
      const categoryId = await resolveCategoryId(parsed.category);
      if (!categoryId) errors.category = 'Valid category id or slug is required';
      if (!Number.isFinite(parsed.price) || parsed.price < 0) {
        errors.price = 'Must be a number >= 0';
      }
      if (!Number.isInteger(parsed.stock) || parsed.stock < 0) {
        errors.stock = 'Must be a non-negative integer';
      }

      if (!mainImages.length) {
        errors.images = 'At least one image is required';
      }

      if (Object.keys(errors).length) {
        return fail(res, 400, 'Validation failed', errors);
      }

      const uploaded = [];
      for (const file of mainImages) {
        try {
          const img = await uploadImageBuffer(file.buffer, {
            folder: 'nova-shop/products'
          });
          uploaded.push(img);
        } catch (upErr) {
          for (const u of uploaded) {
            await deleteByPublicId(u.public_id);
          }
          console.error('Cloudinary upload error:', upErr);
          return fail(res, 502, upErr.message || 'Image upload failed');
        }
      }

      let variantAxes = sanitizeVariantAxes(parsed.variantAxes !== undefined ? parsed.variantAxes : {});
      try {
        variantAxes = await mergeVariantOptionUploads(variantAxes, files, uploadImageBuffer);
      } catch (vErr) {
        for (const u of uploaded) {
          await deleteByPublicId(u.public_id);
        }
        console.error('Variant image upload error:', vErr);
        return fail(res, 502, vErr.message || 'Variant image upload failed');
      }

      const legacy = variantAxesToLegacyFlat(variantAxes);

      const createPayload = {
        name: parsed.name,
        category: categoryId,
        price: parsed.price,
        stock: parsed.stock,
        description: parsed.description,
        shortDescription: parsed.shortDescription,
        comparePrice: parsed.comparePrice ?? undefined,
        costPrice: parsed.costPrice ?? undefined,
        sku: parsed.sku || undefined,
        tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
        images: uploaded,
        isFeatured: parsed.isFeatured,
        isPublished: req.staff ? false : parsed.isPublished,
        approvalStatus: req.staff ? 'pending_approval' : 'approved',
        approvedBy: req.staff ? null : req.authUserId || null,
        approvedAt: req.staff ? null : new Date(),
        rejectionReason: '',
        submittedByStaff: req.staff ? req.staff.id : null,
        ratings: 0,
        numReviews: 0,
        variantAxes,
        color: legacy.color,
        texture: legacy.texture,
        size: legacy.size,
        weight: parsed.weight !== undefined ? String(parsed.weight || '').trim().slice(0, 120) : '',
        weightKg: parsed.weightKg !== undefined ? parsed.weightKg : null
      };
      if (parsed.variantGroupKey !== undefined) {
        createPayload.variantGroupKey = parsed.variantGroupKey || '';
      }
      if (parsed.lowStockThreshold !== undefined) {
        createPayload.lowStockThreshold = parsed.lowStockThreshold;
      }
      const doc = await Product.create(createPayload);

      // Auto-generate 0–10 professional “seed” reviews (Pakistani names)
      try {
        await generateFakeReviewsForProduct({
          productId: doc._id,
          productName: doc.name,
          maxReviews: 10
        });
      } catch (e) {
        console.warn('[reviews] generateFakeReviewsForProduct(create):', e.message);
      }

      const populated = await Product.findById(doc._id)
        .populate('category', 'name slug')
        .exec();

      ok(res, shapeProductDoc(populated), 201, { message: 'Product created' });
      invalidateCatalogCache();

      // async embedding generation (never block response)
      try {
        queueProductEmbeddingUpdate(doc._id);
      } catch (e) {
        console.warn('[aiSearch] queueProductEmbeddingUpdate(create):', e.message);
      }
    } catch (error) {
      if (error.code === 11000) {
        return fail(res, 409, 'A product with this slug already exists');
      }
      if (error.name === 'ValidationError') {
        return fail(res, 400, 'Validation failed', formatMongooseValidation(error));
      }
      console.error('Create product error:', error);
      fail(res, 500, error.message || 'Failed to create product');
    }
  }
);

/**
 * PATCH /api/products/:id/stock — admin (Mongo id)
 */
router.patch('/:id/stock', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return fail(res, 400, 'Invalid product id');
    }

    const { stock } = req.body;
    const product = await Product.findById(id);
    if (!product) {
      return fail(res, 404, 'Product not found');
    }

    const n = Number(stock);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(Math.floor(n))) {
      return fail(res, 400, 'stock must be a non-negative integer', {
        stock: 'Invalid value'
      });
    }

    product.stock = Math.floor(n);
    // Staff updates always require re-approval.
    if (req.staff) {
      product.approvalStatus = 'pending_approval';
      product.isPublished = false;
      product.approvedBy = null;
      product.approvedAt = null;
      product.rejectionReason = '';
      product.submittedByStaff = req.staff.id;
    }

    await product.save();

    const updated = await Product.findById(product._id)
      .populate('category', 'name slug')
      .lean();
    ok(res, shapeProductDoc(updated), 200, { message: 'Stock updated' });
    invalidateCatalogCache();
  } catch (error) {
    if (error.name === 'ValidationError') {
      return fail(res, 400, 'Validation failed', formatMongooseValidation(error));
    }
    console.error('Update stock error:', error);
    fail(res, 500, error.message || 'Failed to update stock');
  }
});

function optionalProductImagesUpload(req, res, next) {
  if (req.is('multipart/form-data')) {
    return upload.any()(req, res, next);
  }
  next();
}

function parseImagePublicIdsToKeep(req) {
  const b = req.body;
  if (!b || !Object.prototype.hasOwnProperty.call(b, 'imagePublicIdsToKeep')) {
    return undefined;
  }
  const raw = b.imagePublicIdsToKeep;
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw);
      return Array.isArray(j) ? j.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Interleaved order for product images, e.g. `["e:public_id1","n:0","e:public_id2"]`.
 * n:k refers to the k-th uploaded file in this request (0-based).
 */
function parseImageBuildOrder(req) {
  const raw = req.body?.imageBuildOrder;
  if (raw == null || raw === '') return null;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw);
      if (!Array.isArray(j)) return null;
      return j.map(String);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * PUT /api/products/:id — admin update; multipart optional for new images
 */
router.put(
  '/:id',
  ...adminOrStaffPermission('manageProducts'),
  optionalProductImagesUpload,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!isValidObjectId(id)) {
        return fail(res, 400, 'Invalid product id');
      }

      const product = await Product.findById(id);
    if (!product) {
      return fail(res, 404, 'Product not found');
    }

      const oldImages = JSON.parse(JSON.stringify(product.images || []));

      if (req.is('multipart/form-data')) {
        const parsed = parseMultipartBody(req);
        if (parsed.name) product.name = parsed.name;
        if (parsed.category !== undefined && parsed.category !== '') {
          const cid = await resolveCategoryId(parsed.category);
          if (!cid) return fail(res, 400, 'Invalid category');
          product.category = cid;
        }
        if (Number.isFinite(parsed.price)) product.price = parsed.price;
        if (Number.isInteger(parsed.stock) && parsed.stock >= 0) {
          product.stock = parsed.stock;
        }
        if (parsed.description !== undefined) product.description = parsed.description;
        if (parsed.shortDescription !== undefined) {
          product.shortDescription = parsed.shortDescription;
        }
        if (parsed.comparePrice !== null && parsed.comparePrice !== undefined) {
          product.comparePrice = parsed.comparePrice;
        }
        if (parsed.costPrice !== null && parsed.costPrice !== undefined) {
          product.costPrice = parsed.costPrice;
        }
        if (parsed.sku !== undefined) product.sku = parsed.sku || undefined;
        if (Array.isArray(parsed.tags)) product.tags = parsed.tags.map(String);
        product.isFeatured = parsed.isFeatured;
        if (parsed.variantGroupKey !== undefined) {
          product.variantGroupKey = parsed.variantGroupKey || '';
        }
        if (req.body.isPublished !== undefined) {
          if (!req.staff) {
            product.isPublished =
              req.body.isPublished === true || req.body.isPublished === 'true';
          }
        }

        if (parsed.lowStockThreshold !== undefined) {
          if (parsed.lowStockThreshold == null) {
            product.lowStockThreshold = null;
          } else {
            product.lowStockThreshold = Math.max(0, Math.floor(parsed.lowStockThreshold));
          }
        }

        const allFiles = req.files || [];
        const newFiles = allFiles.filter((f) => f.fieldname === 'images');
        const buildOrder = parseImageBuildOrder(req);
        const keepIds = parseImagePublicIdsToKeep(req);

        if (buildOrder) {
          const byId = Object.fromEntries(
            (oldImages || [])
              .filter((i) => i && i.public_id)
              .map((i) => [i.public_id, i])
          );
          const uploaded = [];
          for (const file of newFiles) {
            const img = await uploadImageBuffer(file.buffer, {
              folder: 'nova-shop/products'
            });
            uploaded.push(img);
          }
          const out = [];
          for (const token of buildOrder) {
            if (String(token).startsWith('e:')) {
              const id = String(token).slice(2);
              if (byId[id]) out.push(byId[id]);
            } else if (String(token).startsWith('n:')) {
              const k = parseInt(String(token).slice(2), 10);
              if (Number.isInteger(k) && k >= 0 && k < uploaded.length) {
                out.push(uploaded[k]);
              }
            }
          }
          for (let i = 0; i < uploaded.length; i += 1) {
            if (!out.includes(uploaded[i]) && uploaded[i].public_id) {
              try {
                await deleteByPublicId(uploaded[i].public_id);
              } catch (e) {
                console.warn('Orphan new image delete', e.message);
              }
            }
          }
          const usedOldIds = new Set(
            buildOrder
              .filter((t) => String(t).startsWith('e:'))
              .map((t) => String(t).slice(2))
          );
          for (const img of oldImages || []) {
            if (img && img.public_id && !usedOldIds.has(img.public_id)) {
              if (img.public_id) await deleteByPublicId(img.public_id);
            }
          }
          product.images = out;
        } else if (keepIds !== undefined || newFiles.length) {
          if (keepIds === undefined) {
            if (newFiles.length) {
              const uploaded = [];
              for (const file of newFiles) {
                const img = await uploadImageBuffer(file.buffer, {
                  folder: 'nova-shop/products'
                });
                uploaded.push(img);
              }
              product.images = [...(oldImages || []), ...uploaded];
            }
          } else {
            const byId = Object.fromEntries(
              (oldImages || [])
                .filter((i) => i && i.public_id)
                .map((i) => [i.public_id, i])
            );
            const retainedOrdered = keepIds
              .map((id) => byId[id])
              .filter(Boolean);
            const keepSet = new Set(keepIds);
            const removed = (oldImages || []).filter(
              (img) => img && img.public_id && !keepSet.has(img.public_id)
            );
            const uploaded = [];
            for (const file of newFiles) {
              const img = await uploadImageBuffer(file.buffer, {
                folder: 'nova-shop/products'
              });
              uploaded.push(img);
            }
            product.images = [...retainedOrdered, ...uploaded];
            for (const img of removed) {
              if (img.public_id) await deleteByPublicId(img.public_id);
            }
          }
        }

        if (parsed.variantAxes !== undefined) {
          const prevAxes = product.variantAxes ? JSON.parse(JSON.stringify(product.variantAxes)) : {};
          let axes = sanitizeVariantAxes(parsed.variantAxes);
          try {
            axes = await mergeVariantOptionUploads(axes, allFiles, uploadImageBuffer);
          } catch (e) {
            return fail(res, 502, e.message || 'Variant image upload failed');
          }
          for (const pid of diffPublicIdsToRemove(prevAxes, axes)) {
            try {
              await deleteByPublicId(pid);
            } catch (err) {
              console.warn('Variant image delete:', err.message);
            }
          }
          product.variantAxes = axes;
          const leg = variantAxesToLegacyFlat(axes);
          product.color = leg.color;
          product.texture = leg.texture;
          product.size = leg.size;
        } else {
          if (parsed.color !== undefined) product.color = parsed.color || '';
          if (parsed.texture !== undefined) product.texture = parsed.texture || '';
          if (parsed.size !== undefined) product.size = parsed.size || '';
          if (parsed.weight !== undefined) product.weight = parsed.weight || '';
          if (parsed.weightKg !== undefined) product.weightKg = parsed.weightKg;
        }
      } else {
        const body = req.body;
        if (body.name != null) product.name = String(body.name).trim();
        if (body.category != null) {
          const cid = await resolveCategoryId(body.category);
          if (!cid) return fail(res, 400, 'Invalid category');
          product.category = cid;
        }
        if (body.price != null) product.price = Number(body.price);
        if (body.stock != null) product.stock = Math.floor(Number(body.stock));
        if (body.description != null) product.description = String(body.description);
        if (body.shortDescription != null) {
          product.shortDescription = String(body.shortDescription);
        }
        if (body.comparePrice !== undefined) {
          product.comparePrice =
            body.comparePrice === '' || body.comparePrice === null
              ? undefined
              : Number(body.comparePrice);
        }
        if (body.costPrice !== undefined) {
          product.costPrice =
            body.costPrice === '' || body.costPrice === null
              ? undefined
              : Number(body.costPrice);
        }
        if (body.sku !== undefined) product.sku = body.sku ? String(body.sku) : undefined;
        if (body.tags != null) product.tags = Array.isArray(body.tags) ? body.tags : [];
        if (body.isFeatured != null) product.isFeatured = Boolean(body.isFeatured);
        if (!req.staff && body.isPublished != null) product.isPublished = Boolean(body.isPublished);
        if (body.variantAxes !== undefined) {
          const prevAxes = product.variantAxes ? JSON.parse(JSON.stringify(product.variantAxes)) : {};
          const axes = sanitizeVariantAxes(body.variantAxes);
          for (const pid of diffPublicIdsToRemove(prevAxes, axes)) {
            try {
              await deleteByPublicId(pid);
            } catch (err) {
              console.warn('Variant image delete:', err.message);
            }
          }
          product.variantAxes = axes;
          const leg = variantAxesToLegacyFlat(axes);
          product.color = leg.color;
          product.texture = leg.texture;
          product.size = leg.size;
        } else {
          if (body.color !== undefined) product.color = String(body.color || '').trim().slice(0, 120);
          if (body.texture !== undefined) product.texture = String(body.texture || '').trim().slice(0, 120);
          if (body.size !== undefined) product.size = String(body.size || '').trim().slice(0, 120);
          if (body.weight !== undefined) product.weight = String(body.weight || '').trim().slice(0, 120);
          if (body.weightKg !== undefined) {
            product.weightKg =
              body.weightKg === '' || body.weightKg === null ? null : Number(body.weightKg);
          }
        }
        if (body.variantGroupKey !== undefined) {
          product.variantGroupKey = String(body.variantGroupKey || '').trim().slice(0, 120);
        }
        if (body.lowStockThreshold !== undefined) {
          if (body.lowStockThreshold === '' || body.lowStockThreshold === null) {
            product.lowStockThreshold = null;
          } else {
            const n = Math.floor(Number(body.lowStockThreshold));
            product.lowStockThreshold =
              Number.isInteger(n) && n >= 0 ? n : null;
          }
        }
        if (Array.isArray(body.images)) {
          const nextImages = body.images.map((img) => ({
            url: img?.url != null ? String(img.url) : '',
            public_id: img?.public_id != null ? String(img.public_id) : ''
          }));
          const newIds = new Set(nextImages.map((i) => i.public_id).filter(Boolean));
          for (const img of oldImages) {
            if (img.public_id && !newIds.has(img.public_id)) {
              await deleteByPublicId(img.public_id);
            }
          }
          product.images = nextImages;
        }
      }

    await product.save();

      const updated = await Product.findById(product._id)
        .populate('category', 'name slug')
        .lean();
      ok(res, shapeProductDoc(updated), 200, { message: 'Product updated' });
      invalidateCatalogCache();

      // async embedding refresh (never block response)
      try {
        queueProductEmbeddingUpdate(product._id);
      } catch (e) {
        console.warn('[aiSearch] queueProductEmbeddingUpdate(update):', e.message);
      }
  } catch (error) {
      if (error.code === 11000) {
        return fail(res, 409, 'A product with this slug already exists');
      }
    if (error.name === 'ValidationError') {
      return fail(res, 400, 'Validation failed', formatMongooseValidation(error));
    }
      console.error('Update product error:', error);
    fail(res, 500, error.message || 'Failed to update product');
    }
  }
);

/**
 * POST /api/products/:id/reviews — authenticated; one review per product
 */
router.post('/:id/reviews', requireJwtAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return fail(res, 400, 'Invalid product id');
    }

    const product = await Product.findById(id).select('_id name');
    if (!product) {
      return fail(res, 404, 'Product not found');
    }

    const existing = await Review.findOne({
      user: req.authUserId,
      product: product._id
    });
    if (existing) {
      return fail(res, 400, 'You have already reviewed this product');
    }

    const rating = Number(req.body.rating);
    const comment =
      req.body.comment != null ? String(req.body.comment).slice(0, 2000) : '';

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return fail(res, 400, 'rating must be between 1 and 5');
    }

    const verified = await hasDeliveredPurchase(req.authUserId, product._id);

    const review = await Review.create({
      user: req.authUserId,
      product: product._id,
      rating: Math.round(rating),
      comment,
      isVerifiedPurchase: Boolean(verified)
    });

    await recalculateProductRatings(product._id);

    const populated = await Review.findById(review._id)
      .populate('user', 'name avatar')
      .lean();

    ok(res, populated, 201, { message: 'Review added' });
  } catch (error) {
    if (error.code === 11000) {
      return fail(res, 400, 'You have already reviewed this product');
    }
    console.error('Add review error:', error);
    fail(res, 500, error.message || 'Failed to add review');
  }
});

/**
 * PUT /api/products/:id/reviews/:reviewId — update own review
 */
router.put('/:id/reviews/:reviewId', requireJwtAuth, async (req, res) => {
  try {
    const { id, reviewId } = req.params;
    if (!isValidObjectId(id) || !isValidObjectId(reviewId)) {
      return fail(res, 400, 'Invalid id');
    }

    const review = await Review.findOne({
      _id: reviewId,
      product: id,
      user: req.authUserId
    });

    if (!review) {
      return fail(res, 404, 'Review not found');
    }

    const rating =
      req.body.rating != null ? Number(req.body.rating) : review.rating;
    const comment =
      req.body.comment != null
        ? String(req.body.comment).slice(0, 2000)
        : review.comment;

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return fail(res, 400, 'rating must be between 1 and 5');
    }

    review.rating = Math.round(rating);
    review.comment = comment;
    await review.save();
    await recalculateProductRatings(id);

    const populated = await Review.findById(review._id)
      .populate('user', 'name avatar')
      .lean();

    ok(res, populated, 200, { message: 'Review updated' });
  } catch (error) {
    console.error('Update review error:', error);
    fail(res, 500, error.message || 'Failed to update review');
  }
});

/**
 * DELETE /api/products/:id/reviews/:reviewId — admin or review owner
 */
router.delete(
  '/:id/reviews/:reviewId',
  requireJwtAuth,
  async (req, res) => {
    try {
      const { id, reviewId } = req.params;
      if (!isValidObjectId(id) || !isValidObjectId(reviewId)) {
        return fail(res, 400, 'Invalid id');
      }

      const review = await Review.findOne({
        _id: reviewId,
        product: id
      });

      if (!review) {
        return fail(res, 404, 'Review not found');
      }

      const user = await User.findById(req.authUserId).select('role');
      const isAdmin = user?.role === 'admin';
      const isOwner = String(review.user) === String(req.authUserId);

      if (!isAdmin && !isOwner) {
        return fail(res, 403, 'Not allowed to delete this review');
      }

      await Review.deleteOne({ _id: review._id });
      await recalculateProductRatings(id);

      res.status(200).json({
        success: true,
        message: 'Review deleted',
        data: { reviewId: String(review._id) }
      });
    } catch (error) {
      console.error('Delete review error:', error);
      fail(res, 500, error.message || 'Failed to delete review');
    }
  }
);

/**
 * DELETE /api/products/:id — admin; ?hard=true for hard delete
 */
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return fail(res, 400, 'Invalid product id');
    }

    const hard =
      req.query.hard === 'true' || req.query.hard === '1' || req.query.hard === true;
    const product = await Product.findById(id);
    if (!product) {
      return fail(res, 404, 'Product not found');
    }

    if (!hard) {
      product.isPublished = false;
      await product.save();
      invalidateCatalogCache();
      return res.status(200).json({
        success: true,
        message: 'Product unpublished (soft delete)',
        data: { id: String(product._id), soft: true }
      });
    }

    await Review.deleteMany({ product: product._id });
    await deleteProductImagesFromCloudinary(product.images || []);
    await Product.deleteOne({ _id: product._id });
    invalidateCatalogCache();

    res.status(200).json({
      success: true,
      message: 'Product permanently deleted',
      data: { id: String(id), hard: true }
    });
  } catch (error) {
    console.error('Delete product error:', error);
    fail(res, 500, error.message || 'Failed to delete product');
  }
});

/**
 * POST /api/products/:slug/notify-stock — register email when product is out of stock (published only)
 */
router.post('/:slug/notify-stock', async (req, res) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase().trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail(res, 400, 'Valid email is required');
    }

    const product = await Product.findOne({ slug, isPublished: true }).select('_id stock').lean();
    if (!product) {
      return fail(res, 404, 'Product not found');
    }

    const stock = Number(product.stock);
    if (Number.isFinite(stock) && stock > 0) {
      return fail(res, 400, 'This product is already in stock');
    }

    try {
      await StockNotification.create({ product: product._id, email });
    } catch (e) {
      if (e && e.code === 11000) {
        return ok(res, { message: 'You are already registered for stock alerts on this product.' });
      }
      throw e;
    }

    ok(res, { message: 'Thanks — we will email you when this item is back in stock.' });
  } catch (error) {
    console.error('Notify stock error:', error);
    fail(res, 500, error.message || 'Could not save notification');
  }
});

/**
 * GET /api/products/:slug — published product, or soft “unavailable” for unpublished (still in DB)
 */
router.get('/:slug', attachJwtUserSilent, async (req, res) => {
  try {
    const slug = String(req.params.slug).toLowerCase().trim();

    const raw = await Product.findOne({ slug })
      .populate('category', 'name slug')
      .lean();

    if (!raw) {
      return fail(res, 404, 'Product not found');
    }

    if (!raw.isPublished || !productHasValidImage(raw)) {
      const categoryId =
        typeof raw.category === 'object' && raw.category?._id
          ? raw.category._id
          : raw.category;
      const relatedRaw = categoryId
        ? await Product.find({
            isPublished: true,
            category: categoryId,
            _id: { $ne: raw._id },
            ...productHasImageMongoMatch()
          })
            .select(CARD_PRODUCT_SELECT)
            .sort({ createdAt: -1 })
            .limit(12)
            .populate('category', 'name slug')
            .lean()
        : await Product.find({ isPublished: true, _id: { $ne: raw._id }, ...productHasImageMongoMatch() })
            .select(CARD_PRODUCT_SELECT)
            .sort({ createdAt: -1 })
            .limit(12)
            .populate('category', 'name slug')
            .lean();

      const base = shapeProductDoc(raw);
      const cat = raw.category;
      const categoryName =
        cat && typeof cat === 'object' && cat.name ? cat.name : String(base.category || '');
      const categorySlug =
        cat && typeof cat === 'object' && cat.slug ? cat.slug : String(base.category || '');

      return ok(res, {
        unavailable: true,
        message: 'This product is not available for purchase right now.',
        ...base,
        categoryName,
        categorySlug,
        relatedProducts: relatedRaw.map(shapeProductListItem)
      });
    }

    const categoryId =
      typeof raw.category === 'object' && raw.category?._id
        ? raw.category._id
        : raw.category;

    const [reviews, histogramRows, relatedRaw] = await Promise.all([
      Review.find({ product: raw._id })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('user', 'name avatar')
        .lean(),
      Review.aggregate([
        { $match: { product: raw._id } },
        { $group: { _id: '$rating', count: { $sum: 1 } } }
      ]),
      categoryId
        ? Product.find({
            isPublished: true,
            category: categoryId,
            _id: { $ne: raw._id },
            ...productHasImageMongoMatch()
          })
            .select(CARD_PRODUCT_SELECT)
            .sort({ createdAt: -1 })
            .limit(12)
            .populate('category', 'name slug')
            .lean()
        : Promise.resolve([])
    ]);

    const histMap = new Map(histogramRows.map((row) => [row._id, row.count]));
    const ratingHistogram = [5, 4, 3, 2, 1].map((stars) => ({
      stars,
      count: histMap.get(stars) || 0
    }));

    let reviewEligible = false;
    let userHasReview = false;
    if (req.authUserId) {
      const [delivered, existing] = await Promise.all([
        hasDeliveredPurchase(req.authUserId, raw._id),
        Review.exists({ user: req.authUserId, product: raw._id })
      ]);
      userHasReview = Boolean(existing);
      reviewEligible = Boolean(delivered) && !userHasReview;
    }

    const base = shapeProductDoc(raw);
    const cat = raw.category;
    const categoryName =
      cat && typeof cat === 'object' && cat.name ? cat.name : String(base.category || '');
    const categorySlug =
      cat && typeof cat === 'object' && cat.slug ? cat.slug : String(base.category || '');

    ok(res, {
      ...base,
      categoryName,
      categorySlug,
      sku: raw.sku || '',
      reviews,
      ratingHistogram,
      relatedProducts: relatedRaw.map(shapeProductListItem),
      reviewEligible,
      userHasReview
    });
  } catch (error) {
    console.error('Get product error:', error);
    fail(res, 500, error.message || 'Failed to fetch product');
  }
});

module.exports = router;
