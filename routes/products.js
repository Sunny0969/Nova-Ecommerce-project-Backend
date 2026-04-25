const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Review = require('../models/Review');
const StockNotification = require('../models/StockNotification');
const Order = require('../models/Order');
const User = require('../models/User');
const requireAdmin = require('../middleware/requireAdmin');
const { adminOrStaffPermission } = require('../middleware/staffAuth');
const { requireJwtAuth, attachJwtUserSilent } = require('../middleware/jwtAuth');
const { uploadImageBuffer, deleteByPublicId } = require('../lib/cloudinary');
const { queueProductEmbeddingUpdate, hybridSearch, suggestQueries } = require('../services/aiSearch');
const { logSearchQuery, logSearchClick, getTrendingSearches } = require('../services/searchAnalytics');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname !== 'images' && file.fieldname !== 'image') {
      return cb(null, true);
    }
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image uploads are allowed'));
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

  return {
    _id: d._id,
    productId: d.slug,
    slug: d.slug,
    name: d.name,
    category: categorySlug || 'fashion',
    price: Number.isFinite(price) ? price : 0,
    originalPrice: Number.isFinite(comparePrice) ? comparePrice : undefined,
    emoji: '📦',
    imageUrl: firstImg,
    images: Array.isArray(d.images) ? d.images : [],
    description: d.description || '',
    shortDescription: d.shortDescription || '',
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
    variantGroupKey:
      d.variantGroupKey != null && String(d.variantGroupKey).trim()
        ? String(d.variantGroupKey).trim()
        : undefined,
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
    rating,
    search,
    featured,
    inStock
  } = query;

  const and = [{ isPublished: true }];

  const q = String(search || '').trim();
  if (q) {
    and.push({ $text: { $search: q } });
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
    const cat = await Category.findOne({ slug: slugList[0] }).select('_id');
    if (!cat) {
      and.push({ _id: { $in: [] } });
    } else {
      and.push({ category: cat._id });
    }
  } else if (slugList.length > 1) {
    const cats = await Category.find({ slug: { $in: slugList } }).select('_id');
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

  const r = rating !== undefined && rating !== '' ? parseFloat(rating) : NaN;
  if (Number.isFinite(r) && r >= 0 && r <= 5) {
    and.push({ ratings: { $gte: r } });
  }

  if (featured === 'true' || featured === true) {
    and.push({ isFeatured: true });
    }

    if (inStock === 'true') {
    and.push({ stock: { $gt: 0 } });
  }

  return { $and: and };
}

function buildListSort(sortParam) {
  switch (sortParam) {
      case 'price-asc':
      return { price: 1 };
      case 'price-desc':
      return { price: -1 };
    case 'rating':
      return { ratings: -1, numReviews: -1 };
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
 * GET /api/products — paginated list + filters + $text search
 */
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const skip = (page - 1) * limit;
    const sort = buildListSort(req.query.sort);

    let filter;
    try {
      filter = await buildListFilter(req.query);
    } catch (e) {
      if (
        e.code === 28 ||
        (e.message &&
          (e.message.includes('$text') || e.message.includes('text index')))
      ) {
        return fail(res, 400, 'Invalid search query');
      }
      throw e;
    }

    const [raw, totalCount] = await Promise.all([
      Product.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate('category', 'name slug')
        .lean(),
      Product.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    ok(res, {
      products: raw.map(shapeProductDoc),
      totalCount,
      totalPages,
      currentPage: page
    });
  } catch (error) {
    console.error('Get products error:', error);
    fail(res, 500, error.message || 'Failed to fetch products');
  }
});

/**
 * GET /api/products/featured — published + featured, limit 8
 */
router.get('/featured', async (req, res) => {
  try {
    const raw = await Product.find({
      isPublished: true,
      isFeatured: true
    })
      .sort({ createdAt: -1 })
      .limit(8)
      .populate('category', 'name slug')
      .lean();

    ok(res, raw.map(shapeProductDoc));
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
      name: rx
    })
      .select('name slug')
      .sort({ name: 1 })
      .limit(15)
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
      ? await Product.find({ _id: { $in: ids }, isPublished: true })
          .populate('category', 'name slug')
          .lean()
      : [];
    const byId = new Map(rows.map((r) => [String(r._id), r]));
    const ordered = ids.map((id) => byId.get(String(id))).filter(Boolean);

    // analytics (non-blocking)
    logSearchQuery(req, { query: q, resultsCount: ordered.length, source: 'ai-search' }).catch(() => {});

    ok(res, {
      products: ordered.map(shapeProductDoc),
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
    variantGroupKey:
      b.variantGroupKey !== undefined
        ? String(b.variantGroupKey ?? '').trim().slice(0, 120)
        : undefined
  };
}

/**
 * POST /api/products — admin create, multiple images → Cloudinary, slug from name
 */
router.post(
  '/',
  ...adminOrStaffPermission('manageProducts'),
  upload.array('images', 12),
  async (req, res) => {
    try {
      const parsed = parseMultipartBody(req);
      const errors = {};

      if (!parsed.name) errors.name = 'Required';
      const categoryId = await resolveCategoryId(parsed.category);
      if (!categoryId) errors.category = 'Valid category id or slug is required';
      if (!Number.isFinite(parsed.price) || parsed.price < 0) {
        errors.price = 'Must be a number >= 0';
      }
      if (!Number.isInteger(parsed.stock) || parsed.stock < 0) {
        errors.stock = 'Must be a non-negative integer';
      }

      const files = req.files || [];
      if (!files.length) {
        errors.images = 'At least one image is required';
      }

      if (Object.keys(errors).length) {
        return fail(res, 400, 'Validation failed', errors);
      }

      const uploaded = [];
      for (const file of files) {
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
        numReviews: 0
      };
      if (parsed.color !== undefined) createPayload.color = parsed.color || '';
      if (parsed.texture !== undefined) createPayload.texture = parsed.texture || '';
      if (parsed.size !== undefined) createPayload.size = parsed.size || '';
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
    return upload.array('images', 12)(req, res, next);
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
        if (parsed.color !== undefined) product.color = parsed.color || '';
        if (parsed.texture !== undefined) product.texture = parsed.texture || '';
        if (parsed.size !== undefined) product.size = parsed.size || '';
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

        const newFiles = req.files || [];
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
        if (body.color !== undefined) product.color = String(body.color || '').trim().slice(0, 120);
        if (body.texture !== undefined) product.texture = String(body.texture || '').trim().slice(0, 120);
        if (body.size !== undefined) product.size = String(body.size || '').trim().slice(0, 120);
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
        if (body.color !== undefined) product.color = String(body.color || '').trim().slice(0, 120);
        if (body.texture !== undefined) product.texture = String(body.texture || '').trim().slice(0, 120);
        if (body.size !== undefined) product.size = String(body.size || '').trim().slice(0, 120);
        if (body.variantGroupKey !== undefined) {
          product.variantGroupKey = String(body.variantGroupKey || '').trim().slice(0, 120);
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
      return res.status(200).json({
        success: true,
        message: 'Product unpublished (soft delete)',
        data: { id: String(product._id), soft: true }
      });
    }

    await Review.deleteMany({ product: product._id });
    await deleteProductImagesFromCloudinary(product.images || []);
    await Product.deleteOne({ _id: product._id });

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

    if (!raw.isPublished) {
      const categoryId =
        typeof raw.category === 'object' && raw.category?._id
          ? raw.category._id
          : raw.category;
      const relatedRaw = categoryId
        ? await Product.find({
            isPublished: true,
            category: categoryId,
            _id: { $ne: raw._id }
          })
            .sort({ createdAt: -1 })
            .limit(12)
            .populate('category', 'name slug')
            .lean()
        : await Product.find({ isPublished: true, _id: { $ne: raw._id } })
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
        relatedProducts: relatedRaw.map(shapeProductDoc)
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
            _id: { $ne: raw._id }
          })
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
      relatedProducts: relatedRaw.map(shapeProductDoc),
      reviewEligible,
      userHasReview
    });
  } catch (error) {
    console.error('Get product error:', error);
    fail(res, 500, error.message || 'Failed to fetch product');
  }
});

module.exports = router;
