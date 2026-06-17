const express = require('express');
const mongoose = require('mongoose');
const slugify = require('slugify');
const Category = require('../../models/Category');
const ProductSubcategory = require('../../models/ProductSubcategory');
const Product = require('../../models/Product');
const { invalidateCatalogCache } = require('../../lib/invalidatePublicCache');
const {
  countProductsBySubcategory,
  countProductsMatchingSubcategory,
  normalizeGender,
  normalizeKeywords,
  GENDERED_CATEGORY_SLUGS
} = require('../../lib/shopSubcategories');
const { delByPrefix } = require('../../lib/apiCache');

const router = express.Router();

function ok(res, data, status = 200) {
  res.status(status).json({ success: true, data });
}

function fail(res, status, message, errors) {
  const body = { success: false, message };
  if (errors && Object.keys(errors).length) body.errors = errors;
  res.status(status).json(body);
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function invalidateSubcategoryCache() {
  delByPrefix('subcategories:tree:');
  invalidateCatalogCache();
}

function categoryUsesGender(categorySlug) {
  return GENDERED_CATEGORY_SLUGS.has(String(categorySlug || '').toLowerCase());
}

/**
 * GET /api/admin/subcategories?category=clothing
 */
router.get('/', async (req, res) => {
  try {
    const categorySlug = String(req.query.category || 'clothing').trim().toLowerCase();
    const cat = await Category.findOne({ slug: categorySlug }).select('_id slug name').lean();
    if (!cat) {
      return fail(res, 404, 'Category not found');
    }

    const rows = await ProductSubcategory.find({ category: cat._id })
      .sort({ gender: 1, displayOrder: 1, name: 1 })
      .lean();

    const withCounts = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        productCount: await countProductsMatchingSubcategory(cat._id, row)
      }))
    );

    ok(res, {
      category: cat,
      usesGender: categoryUsesGender(categorySlug),
      subcategories: withCounts
    });
  } catch (err) {
    console.error('Admin list subcategories error:', err);
    fail(res, 500, err.message || 'Failed to list subcategories');
  }
});

/**
 * POST /api/admin/subcategories
 * Body: { categorySlug, gender?, name, slug?, displayOrder?, isActive?, matchKeywords? }
 */
router.post('/', async (req, res) => {
  try {
    const categorySlug = String(req.body.categorySlug || 'clothing').trim().toLowerCase();
    const usesGender = categoryUsesGender(categorySlug);
    const gender = usesGender ? normalizeGender(req.body.gender) : '';
    const name = String(req.body.name || '').trim();

    if (usesGender && !gender) return fail(res, 400, 'gender must be women or men');
    if (!name) return fail(res, 400, 'name is required');

    const cat = await Category.findOne({ slug: categorySlug }).select('_id');
    if (!cat) return fail(res, 404, 'Category not found');

    let slug =
      req.body.slug != null && String(req.body.slug).trim()
        ? slugify(String(req.body.slug), { lower: true, strict: true })
        : slugify(name, { lower: true, strict: true });

    const exists = await ProductSubcategory.findOne({ category: cat._id, gender, slug }).select('_id');
    if (exists) return fail(res, 409, 'Subcategory slug already exists for this category');

    const row = await ProductSubcategory.create({
      category: cat._id,
      gender,
      name,
      slug,
      matchKeywords: normalizeKeywords(req.body.matchKeywords),
      displayOrder: Number(req.body.displayOrder) || 0,
      isActive: req.body.isActive !== false
    });

    invalidateSubcategoryCache();
    ok(res, row, 201);
  } catch (err) {
    console.error('Create subcategory error:', err);
    fail(res, 500, err.message || 'Failed to create subcategory');
  }
});

/**
 * PUT /api/admin/subcategories/:id
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return fail(res, 400, 'Invalid id');

    const row = await ProductSubcategory.findById(id);
    if (!row) return fail(res, 404, 'Subcategory not found');

    const cat = await Category.findById(row.category).select('slug').lean();
    const usesGender = categoryUsesGender(cat?.slug);

    if (req.body.name != null) {
      const name = String(req.body.name).trim();
      if (!name) return fail(res, 400, 'name cannot be empty');
      row.name = name;
    }

    if (req.body.slug != null && String(req.body.slug).trim()) {
      const nextSlug = slugify(String(req.body.slug), { lower: true, strict: true });
      const taken = await ProductSubcategory.findOne({
        category: row.category,
        gender: row.gender,
        slug: nextSlug,
        _id: { $ne: row._id }
      }).select('_id');
      if (taken) return fail(res, 409, 'Slug already in use');
      row.slug = nextSlug;
    }

    if (req.body.gender != null && usesGender) {
      const gender = normalizeGender(req.body.gender);
      if (!gender) return fail(res, 400, 'gender must be women or men');
      row.gender = gender;
    }

    if (req.body.matchKeywords != null) {
      row.matchKeywords = normalizeKeywords(req.body.matchKeywords);
    }

    if (req.body.displayOrder != null) {
      row.displayOrder = Number(req.body.displayOrder) || 0;
    }

    if (req.body.isActive != null) {
      row.isActive = Boolean(req.body.isActive);
    }

    await row.save();
    invalidateSubcategoryCache();
    ok(res, row);
  } catch (err) {
    console.error('Update subcategory error:', err);
    fail(res, 500, err.message || 'Failed to update subcategory');
  }
});

/**
 * DELETE /api/admin/subcategories/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return fail(res, 400, 'Invalid id');

    const row = await ProductSubcategory.findById(id);
    if (!row) return fail(res, 404, 'Subcategory not found');

    const linked = await countProductsBySubcategory(row._id);
    if (linked > 0) {
      return fail(res, 409, `Cannot delete — ${linked} product(s) use this subcategory`);
    }

    await row.deleteOne();
    invalidateSubcategoryCache();
    ok(res, { deleted: true });
  } catch (err) {
    console.error('Delete subcategory error:', err);
    fail(res, 500, err.message || 'Failed to delete subcategory');
  }
});

module.exports = router;
