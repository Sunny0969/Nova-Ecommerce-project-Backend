const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const slugify = require('slugify');

const Category = require('../models/Category');
const Product = require('../models/Product');
const requireAdmin = require('../middleware/requireAdmin');
const { adminOrStaffPermission } = require('../middleware/staffAuth');
const { uploadImageBuffer, deleteByPublicId } = require('../lib/cloudinary');
const { publishedProductCountStages } = require('../lib/syncCategoryVisibility');
const { getOrSet, CACHE_KEYS } = require('../lib/apiCache');
const { setPublicApiCacheHeaders } = require('../lib/publicApiCacheHeaders');
const { invalidateCatalogCache } = require('../lib/invalidatePublicCache');
const { sortCategoriesAlphabetically } = require('../lib/sortCategories');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname !== 'image') {
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

function fail(res, status, message, errors) {
  const body = { success: false, message };
  if (errors && Object.keys(errors).length) body.errors = errors;
  res.status(status).json(body);
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

async function slugExists(slug, excludeId) {
  const q = { slug: String(slug).toLowerCase().trim() };
  if (excludeId) q._id = { $ne: excludeId };
  return Category.exists(q);
}

/**
 * GET /api/categories — active categories with published product counts (storefront)
 */
router.get('/', async (req, res) => {
  try {
    const productColl = Product.collection.name;
    const { value: rows, hit } = await getOrSet(CACHE_KEYS.CATEGORIES_LIST, async () =>
      Category.aggregate([
        { $match: { isActive: true } },
        ...publishedProductCountStages(productColl),
        { $match: { productCount: { $gt: 0 } } },
        { $sort: { name: 1 } }
      ]).collation({ locale: 'en', strength: 2 })
    );

    setPublicApiCacheHeaders(res, { hit });
    ok(res, sortCategoriesAlphabetically(rows));
  } catch (err) {
    console.error('List categories error:', err);
    fail(res, 500, err.message || 'Failed to list categories');
  }
});

/**
 * PUT /api/categories/reorder — admin: bulk update displayOrder
 * Body: { items: [{ id: string, displayOrder: number }, ...] }
 */
router.put('/reorder', ...adminOrStaffPermission('manageCategories'), async (req, res) => {
  try {
    if (req.staff) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission for this action"
      });
    }

    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return fail(res, 400, 'items must be a non-empty array');
    }

    const bulk = [];
    for (const row of items) {
      const id = row?.id ?? row?._id;
      const displayOrder = row?.displayOrder;
      if (!isValidObjectId(id)) {
        return fail(res, 400, 'Each item must include a valid id', {
          id: 'Invalid category id'
        });
      }
      const n = Number(displayOrder);
      if (!Number.isFinite(n)) {
        return fail(res, 400, 'Each item must include displayOrder', {
          displayOrder: 'Must be a number'
        });
      }
      bulk.push({
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(id) },
          update: { $set: { displayOrder: n } }
        }
      });
    }

    await Category.bulkWrite(bulk);
    invalidateCatalogCache();
    ok(res, { updated: items.length }, 200, { message: 'Display order updated' });
  } catch (err) {
    console.error('Reorder categories error:', err);
    fail(res, 500, err.message || 'Failed to reorder categories');
  }
});

/**
 * POST /api/categories — admin: create (optional image → Cloudinary)
 */
router.post('/', ...adminOrStaffPermission('manageCategories'), upload.single('image'), async (req, res) => {
  try {
    const name = req.body.name != null ? String(req.body.name).trim() : '';
    if (!name) {
      return fail(res, 400, 'name is required');
    }

    let slug =
      req.body.slug != null && String(req.body.slug).trim() !== ''
        ? slugify(String(req.body.slug), { lower: true, strict: true })
        : slugify(name, { lower: true, strict: true });
    if (!slug) slug = 'category';

    if (await slugExists(slug)) {
      return fail(res, 409, 'A category with this slug already exists', {
        slug: 'Must be unique'
      });
    }

    let parent = null;
    if (req.body.parent != null && String(req.body.parent).trim() !== '') {
      if (!isValidObjectId(req.body.parent)) {
        return fail(res, 400, 'parent must be a valid category id');
      }
      const p = await Category.findById(req.body.parent);
      if (!p) {
        return fail(res, 400, 'Parent category not found');
      }
      parent = p._id;
    }

    const displayOrder =
      req.body.displayOrder != null && req.body.displayOrder !== ''
        ? Number(req.body.displayOrder)
        : 0;
    const isActive =
      req.body.isActive === undefined
        ? true
        : req.body.isActive === true ||
          req.body.isActive === 'true' ||
          req.body.isActive === '1';

    let image = { url: '', public_id: '' };
    if (req.file?.buffer) {
      try {
        image = await uploadImageBuffer(req.file.buffer, {
          folder: 'nova-shop/categories'
        });
      } catch (uploadErr) {
        console.error('Cloudinary upload error:', uploadErr);
        return fail(res, 502, uploadErr.message || 'Image upload failed');
      }
    }

    const doc = await Category.create({
      name,
      slug,
      description:
        req.body.description != null ? String(req.body.description) : '',
      image,
      parent,
      displayOrder: Number.isFinite(displayOrder) ? displayOrder : 0,
      isActive,
      // If request comes from staff, scope ownership to that staff.
      // For admin requests, keep it null (admin can manage everything anyway).
      createdByStaff: req.staff?.id || null
    });

    const withCount = await Category.aggregate([
      { $match: { _id: doc._id } },
      {
        $lookup: {
          from: Product.collection.name,
          localField: '_id',
          foreignField: 'category',
          as: 'products'
        }
      },
      { $addFields: { productCount: { $size: '$products' } } },
      { $project: { products: 0 } }
    ]);

    invalidateCatalogCache();
    ok(res, withCount[0] || doc.toObject(), 201, { message: 'Category created' });
  } catch (err) {
    if (err.code === 11000) {
      return fail(res, 409, 'Duplicate slug');
    }
    console.error('Create category error:', err);
    fail(res, 500, err.message || 'Failed to create category');
  }
});

/**
 * GET /api/categories/:slug — single active category + product count
 */
router.get('/:slug', async (req, res) => {
  try {
    const slug = String(req.params.slug).toLowerCase().trim();
    const cacheKey = CACHE_KEYS.categorySlug(slug);
    const { value: row, hit } = await getOrSet(cacheKey, async () => {
      const rows = await Category.aggregate([
        { $match: { slug, isActive: true } },
        {
          $lookup: {
            from: Product.collection.name,
            localField: '_id',
            foreignField: 'category',
            as: 'products'
          }
        },
        { $addFields: { productCount: { $size: '$products' } } },
        { $project: { products: 0 } }
      ]);
      return rows[0] || null;
    });

    if (!row) {
      return fail(res, 404, 'Category not found');
    }

    setPublicApiCacheHeaders(res, { hit });
    ok(res, row);
  } catch (err) {
    console.error('Get category error:', err);
    fail(res, 500, err.message || 'Failed to fetch category');
  }
});

function optionalImageUpload(req, res, next) {
  if (req.is('multipart/form-data')) {
    return upload.single('image')(req, res, next);
  }
  next();
}

/**
 * PUT /api/categories/:id — admin: update (JSON or multipart with image)
 */
router.put('/:id', ...adminOrStaffPermission('manageCategories'), optionalImageUpload, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return fail(res, 400, 'Invalid category id');
    }

    const category = await Category.findById(id);
    if (!category) {
      return fail(res, 404, 'Category not found');
    }

    // Staff can only update their own categories
    if (req.staff && String(category.createdByStaff || '') !== String(req.staff.id)) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission for this action"
      });
    }

    if (req.body.name != null) {
      const name = String(req.body.name).trim();
      if (!name) return fail(res, 400, 'name cannot be empty');
      category.name = name;
    }

    if (req.body.slug != null && String(req.body.slug).trim() !== '') {
      const nextSlug = slugify(String(req.body.slug), { lower: true, strict: true });
      if (nextSlug && (await slugExists(nextSlug, category._id))) {
        return fail(res, 409, 'Slug already in use');
      }
      if (nextSlug) category.slug = nextSlug;
    }

    if (req.body.description !== undefined) {
      category.description =
        req.body.description != null ? String(req.body.description) : '';
    }

    if (req.body.parent !== undefined) {
      if (req.body.parent === null || req.body.parent === '') {
        category.parent = null;
      } else {
        if (!isValidObjectId(req.body.parent)) {
          return fail(res, 400, 'parent must be a valid id or empty');
        }
        if (String(req.body.parent) === String(category._id)) {
          return fail(res, 400, 'Category cannot be its own parent');
        }
        const p = await Category.findById(req.body.parent);
        if (!p) return fail(res, 400, 'Parent category not found');
        category.parent = p._id;
      }
    }

    if (req.body.displayOrder !== undefined && req.body.displayOrder !== '') {
      const n = Number(req.body.displayOrder);
      if (Number.isFinite(n)) category.displayOrder = n;
    }

    if (req.body.isActive !== undefined) {
      category.isActive =
        req.body.isActive === true ||
        req.body.isActive === 'true' ||
        req.body.isActive === '1';
    }

    if (req.file?.buffer) {
      try {
        const oldPublicId = category.image?.public_id;
        const uploaded = await uploadImageBuffer(req.file.buffer, {
          folder: 'nova-shop/categories'
        });
        category.image = uploaded;
        if (oldPublicId) {
          try {
            await deleteByPublicId(oldPublicId);
          } catch (delErr) {
            console.warn('Could not delete old Cloudinary asset:', delErr.message);
          }
        }
      } catch (uploadErr) {
        console.error('Cloudinary upload error:', uploadErr);
        return fail(res, 502, uploadErr.message || 'Image upload failed');
      }
    }

    await category.save();

    const withCount = await Category.aggregate([
      { $match: { _id: category._id } },
      {
        $lookup: {
          from: Product.collection.name,
          localField: '_id',
          foreignField: 'category',
          as: 'products'
        }
      },
      { $addFields: { productCount: { $size: '$products' } } },
      { $project: { products: 0 } }
    ]);

    invalidateCatalogCache();
    ok(res, withCount[0] || category.toObject(), 200, { message: 'Category updated' });
  } catch (err) {
    if (err.code === 11000) {
      return fail(res, 409, 'Duplicate slug');
    }
    console.error('Update category error:', err);
    fail(res, 500, err.message || 'Failed to update category');
  }
});

/**
 * DELETE /api/categories/:id — admin: delete if no products reference it
 */
router.delete('/:id', ...adminOrStaffPermission('manageCategories'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return fail(res, 400, 'Invalid category id');
    }

    const category = await Category.findById(id);
    if (!category) {
      return fail(res, 404, 'Category not found');
    }

    // Staff can only delete their own categories
    if (req.staff && String(category.createdByStaff || '') !== String(req.staff.id)) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission for this action"
      });
    }

    const count = await Product.countDocuments({ category: category._id });
    if (count > 0) {
      return fail(res, 400, `Cannot delete: ${count} product(s) use this category`, {
        products: 'Reassign or remove products first'
      });
    }

    const publicId = category.image?.public_id;
    await Category.deleteOne({ _id: category._id });

    if (publicId) {
      try {
        await deleteByPublicId(publicId);
      } catch (delErr) {
        console.warn('Could not delete Cloudinary asset:', delErr.message);
      }
    }

    invalidateCatalogCache();
    res.status(200).json({
      success: true,
      message: 'Category deleted',
      data: { id: String(category._id) }
    });
  } catch (err) {
    console.error('Delete category error:', err);
    fail(res, 500, err.message || 'Failed to delete category');
  }
});

module.exports = router;
