/**
 * Admin product list + bulk operations — /api/admin/products
 */

const express = require('express');
const mongoose = require('mongoose');
const Product = require('../../models/Product');
const Category = require('../../models/Category');
const Review = require('../../models/Review');
const { deleteByPublicId } = require('../../lib/cloudinary');

const router = express.Router();

function ok(res, data, status = 200) {
  res.status(status).json({ success: true, data });
}

function fail(res, status, message) {
  res.status(status).json({ success: false, message });
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

/** True only for 24-char hex strings — avoids mongoose.isValidObjectId false positives. */
function strictMongoId(v) {
  if (v == null) return false;
  return typeof v === 'string' && /^[a-fA-F0-9]{24}$/.test(v);
}

/**
 * Products may legacy-store `category` as a slug string; populate() then throws CastError.
 * Resolve category docs in batch for lean product rows.
 */
async function attachCategoriesToProducts(docs) {
  if (!Array.isArray(docs) || !docs.length) return docs;
  const idSet = new Set();
  const slugSet = new Set();
  for (const p of docs) {
    const c = p.category;
    if (c == null) continue;
    if (typeof c === 'object' && c._id != null) {
      idSet.add(String(c._id));
    } else {
      const s = String(c).trim();
      if (!s) continue;
      if (strictMongoId(s)) idSet.add(s);
      else slugSet.add(s.toLowerCase());
    }
  }
  const catById = new Map();
  const catBySlug = new Map();
  const [byId, bySlug] = await Promise.all([
    idSet.size
      ? Category.find({ _id: { $in: [...idSet] } })
          .select('name slug')
          .lean()
      : [],
    slugSet.size
      ? Category.find({ slug: { $in: [...slugSet] } })
          .select('name slug')
          .lean()
      : []
  ]);
  for (const row of byId) catById.set(String(row._id), row);
  for (const row of bySlug) catBySlug.set(row.slug, row);

  return docs.map((p) => {
    const c = p.category;
    if (c == null) return p;
    if (typeof c === 'object' && c.name) return p;
    const s = String(c).trim();
    if (!s) return { ...p, category: null };
    if (strictMongoId(s)) {
      const cat = catById.get(s);
      return cat ? { ...p, category: cat } : { ...p, category: null };
    }
    const cat = catBySlug.get(s.toLowerCase());
    return cat ? { ...p, category: cat } : { ...p, category: null };
  });
}

async function attachCategoryToOneProductLean(p) {
  if (!p) return p;
  const c = p.category;
  if (c == null) return p;
  if (typeof c === 'object' && c.name) return p;
  const s = String(c).trim();
  if (!s) return { ...p, category: null };
  if (strictMongoId(s)) {
    const cat = await Category.findById(s).select('name slug').lean();
    return cat ? { ...p, category: cat } : { ...p, category: null };
  }
  const cat = await Category.findOne({ slug: s.toLowerCase() }).select('name slug').lean();
  return cat ? { ...p, category: cat } : { ...p, category: null };
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function shapeListItem(doc) {
  const d = doc;
  const cat = d.category;
  const firstImg = Array.isArray(d.images) && d.images[0]?.url ? d.images[0].url : '';
  const categoryLabel =
    typeof cat === 'object' && cat?.name ? cat.name : '—';
  const categorySlug =
    typeof cat === 'object' && cat?.slug ? cat.slug : '';

  return {
    _id: d._id,
    name: d.name,
    slug: d.slug,
    price: Number(d.price) || 0,
    stock: Number.isFinite(Number(d.stock)) ? Math.max(0, Math.floor(Number(d.stock))) : 0,
    isPublished: Boolean(d.isPublished),
    approvalStatus: d.approvalStatus || 'approved',
    imageUrl: firstImg,
    submittedByStaff:
      d.submittedByStaff && typeof d.submittedByStaff === 'object'
        ? { _id: d.submittedByStaff._id, name: d.submittedByStaff.name, email: d.submittedByStaff.email }
        : d.submittedByStaff || null,
    category: { name: categoryLabel, slug: categorySlug, _id: cat?._id || cat },
    createdAt: d.createdAt
  };
}

/**
 * GET /api/admin/products/pending — products awaiting approval
 * Register before /:id
 */
router.get('/pending', async (req, res) => {
  try {
    const products = await Product.find({ approvalStatus: 'pending_approval' })
      .populate({ path: 'submittedByStaff', select: 'name email' })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    const withCats = await attachCategoriesToProducts(products);
    return res.json({ success: true, products: withCats.map(shapeListItem) });
  } catch (e) {
    console.error('Admin pending products:', e);
    return res.status(500).json({ success: false, message: e.message || 'Failed to load pending products' });
  }
});

/**
 * POST /api/admin/products/:id/approve — approve product and publish it
 */
router.post('/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return fail(res, 400, 'Invalid product id');
    const updated = await Product.findByIdAndUpdate(
      id,
      {
        $set: {
          approvalStatus: 'approved',
          isPublished: true,
          approvedBy: req.authUserId || null,
          approvedAt: new Date(),
          rejectionReason: ''
        }
      },
      { new: true }
    ).lean();
    if (!updated) return fail(res, 404, 'Product not found');
    ok(res, updated);
  } catch (e) {
    console.error('Admin approve product:', e);
    fail(res, 500, e.message || 'Failed to approve product');
  }
});

/**
 * POST /api/admin/products/:id/reject — reject with { reason }
 */
router.post('/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return fail(res, 400, 'Invalid product id');
    const reason = String(req.body?.reason || '').trim().slice(0, 2000);
    const updated = await Product.findByIdAndUpdate(
      id,
      {
        $set: {
          approvalStatus: 'rejected',
          isPublished: false,
          approvedBy: null,
          approvedAt: null,
          rejectionReason: reason
        }
      },
      { new: true }
    ).lean();
    if (!updated) return fail(res, 404, 'Product not found');
    ok(res, updated);
  } catch (e) {
    console.error('Admin reject product:', e);
    fail(res, 500, e.message || 'Failed to reject product');
  }
});

/**
 * Form payload: full product (drafts, unpublished) for admin editor.
 */
function shapeProductForm(p) {
  if (!p) return null;
  const cat = p.category;
  const cObj =
    typeof cat === 'object' && cat && cat._id
      ? { _id: cat._id, name: cat.name || '', slug: cat.slug || '' }
      : { _id: null, name: '', slug: '' };
  if (!cObj._id && typeof p.category === 'string') cObj._id = p.category;

  const st = Number(p.stock);
  const low =
    p.lowStockThreshold == null
      ? null
      : Math.max(0, Math.floor(Number(p.lowStockThreshold)));

  return {
    _id: p._id,
    name: p.name,
    slug: p.slug,
    shortDescription: p.shortDescription != null ? String(p.shortDescription) : '',
    description: p.description != null ? String(p.description) : '',
    price: Number(p.price) || 0,
    comparePrice: p.comparePrice == null || p.comparePrice === '' ? null : Number(p.comparePrice),
    costPrice: p.costPrice == null || p.costPrice === '' ? null : Number(p.costPrice),
    sku: p.sku != null && String(p.sku).trim() ? String(p.sku).trim() : '',
    stock: Number.isFinite(st) && st >= 0 ? Math.floor(st) : 0,
    lowStockThreshold: low,
    category: cObj,
    categoryId: cObj._id,
    tags: Array.isArray(p.tags) ? p.tags : [],
    images: Array.isArray(p.images) ? p.images : [],
    isFeatured: Boolean(p.isFeatured),
    isPublished: Boolean(p.isPublished),
    color: p.color != null ? String(p.color) : '',
    texture: p.texture != null ? String(p.texture) : '',
    size: p.size != null ? String(p.size) : '',
    variantGroupKey: p.variantGroupKey != null ? String(p.variantGroupKey) : ''
  };
}

/**
 * GET /api/admin/products — paginated, search, category slug, status
 */
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const skip = (page - 1) * limit;

    const and = [];
    const q = String(req.query.search || '').trim();
    if (q) {
      and.push({
        $or: [
          { name: new RegExp(escapeRegex(q), 'i') },
          { slug: new RegExp(escapeRegex(q), 'i') }
        ]
      });
    }

    const status = String(req.query.status || 'all').toLowerCase();
    if (status === 'published') and.push({ isPublished: true });
    else if (status === 'draft' || status === 'unpublished') and.push({ isPublished: false });

    const rawCat = req.query.category;
    if (rawCat && String(rawCat).toLowerCase() !== 'all') {
      const catStr = String(rawCat).trim();
      if (strictMongoId(catStr)) {
        and.push({ category: catStr });
      } else {
        const cat = await Category.findOne({
          slug: catStr.toLowerCase()
        }).select('_id');
        if (cat) {
          and.push({
            $or: [{ category: cat._id }, { category: catStr.toLowerCase() }]
          });
        } else and.push({ _id: { $in: [] } });
      }
    }

    const filter = and.length ? { $and: and } : {};

    const [rawRows, totalCount] = await Promise.all([
      Product.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(filter)
    ]);

    const raw = await attachCategoriesToProducts(rawRows);

    const totalPages = Math.ceil(totalCount / limit) || 0;

    ok(res, {
      products: raw.map(shapeListItem),
      totalCount,
      totalPages,
      currentPage: page
    });
  } catch (error) {
    console.error('Admin list products error:', error);
    fail(res, 500, error.message || 'Failed to fetch products');
  }
});

/**
 * GET /api/admin/products/:id — full product for edit form (Mongo _id, includes drafts)
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return fail(res, 400, 'Invalid product id');
    }
    const docLean = await Product.findById(id).lean();
    if (!docLean) {
      return fail(res, 404, 'Product not found');
    }
    const doc = await attachCategoryToOneProductLean(docLean);
    ok(res, shapeProductForm(doc));
  } catch (error) {
    console.error('Admin get product error:', error);
    fail(res, 500, error.message || 'Failed to fetch product');
  }
});

/**
 * POST /api/admin/products/bulk — { ids: string[], action: 'publish'|'unpublish'|'delete' }
 * delete = soft (unpublish). Use action 'deleteHard' to permanently remove (and reviews/images).
 */
router.post('/bulk', async (req, res) => {
  try {
    const { ids, action } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) {
      return fail(res, 400, 'ids array is required');
    }
    const valid = [...new Set(ids.map(String))].filter((id) => isValidObjectId(id));
    if (!valid.length) {
      return fail(res, 400, 'No valid product ids');
    }

    if (action === 'publish') {
      const r = await Product.updateMany(
        { _id: { $in: valid } },
        { $set: { isPublished: true } }
      );
      return ok(res, { modified: r.modifiedCount });
    }

    if (action === 'unpublish') {
      const r = await Product.updateMany(
        { _id: { $in: valid } },
        { $set: { isPublished: false } }
      );
      return ok(res, { modified: r.modifiedCount });
    }

    if (action === 'delete') {
      const r = await Product.updateMany(
        { _id: { $in: valid } },
        { $set: { isPublished: false } }
      );
      return ok(res, { modified: r.modifiedCount, soft: true });
    }

    if (action === 'deleteHard') {
      const docs = await Product.find({ _id: { $in: valid } });
      for (const product of docs) {
        await Review.deleteMany({ product: product._id });
        await deleteProductImagesFromCloudinary(product.images || []);
        await Product.deleteOne({ _id: product._id });
      }
      return ok(res, { deleted: docs.length, hard: true });
    }

    return fail(
      res,
      400,
      'Invalid action. Use publish, unpublish, delete, or deleteHard'
    );
  } catch (error) {
    console.error('Admin bulk products error:', error);
    fail(res, 500, error.message || 'Bulk action failed');
  }
});

module.exports = router;
