/**
 * Staff auth endpoints — /api/staff/*
 */

const express = require('express');
const StaffAccess = require('../models/StaffAccess');
const Product = require('../models/Product');
const Category = require('../models/Category');
const { isStaff, hasPermission } = require('../middleware/staffAuth');

const router = express.Router();

function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/* ============================================================
   STAFF LOGIN
============================================================ */

router.post('/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return fail(res, 400, 'Email and password are required');
    }

    const staff = await StaffAccess.findOne({ email })
      .select('+password name email status blockedUntil permissions');

    if (!staff) {
      return fail(res, 404, 'Staff account not found');
    }

    // Block logic
    if (staff.status === 'blocked') {
      const until = staff.blockedUntil
        ? new Date(staff.blockedUntil).getTime()
        : null;

      if (until && until <= Date.now()) {
        staff.status = 'active';
        staff.blockedUntil = null;
        await staff.save();
      } else {
        return fail(res, 403, 'Your access has been blocked');
      }
    }

    const match = await staff.comparePassword(password);
    if (!match) {
      return fail(res, 401, 'Incorrect password');
    }

    staff.lastLogin = new Date();
    await staff.save();

    const token = staff.getJWTToken();

    return ok(res, {
      token,
      staff: {
        id: staff._id,
        role: 'staff',
        name: staff.name,
        email: staff.email,
        permissions: staff.permissions || {}
      }
    });

  } catch (err) {
    console.error('[Staff Login Error]', err);
    return fail(res, 500, 'Login failed');
  }
});

/* ============================================================
   VERIFY STAFF TOKEN
============================================================ */

router.get('/me', isStaff, (req, res) => {
  return ok(res, {
    staff: {
      id: req.staff.id,
      name: req.staff.name,
      email: req.staff.email,
      role: 'staff'
    },
    permissions: req.staff.permissions || {},
    status: 'active'
  });
});

/* ============================================================
   STAFF PRODUCTS (view only their own)
============================================================ */

router.get('/products', isStaff, hasPermission('manageProducts'), async (req, res) => {
  try {
    const rows = await Product.find({
      submittedByStaff: req.staff.id
    })
      .select('name slug approvalStatus rejectionReason isPublished createdAt updatedAt')
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean();

    return ok(res, rows);
  } catch (err) {
    return fail(res, 500, 'Failed to load products');
  }
});

/* ============================================================
   STAFF CATEGORIES (scoped to their own)
============================================================ */

router.get('/categories', isStaff, hasPermission('manageCategories'), async (req, res) => {
  try {
    const rows = await Category.find({ createdByStaff: req.staff.id })
      .sort({ displayOrder: 1, name: 1 })
      .lean();

    return ok(res, rows);
  } catch (err) {
    return fail(res, 500, 'Failed to load categories');
  }
});

router.post('/categories', isStaff, hasPermission('manageCategories'), async (req, res) => {
  try {
    const slugify = require('slugify');
    const name = String(req.body?.name || '').trim();
    if (!name) return fail(res, 400, 'Name is required');

    const slug = slugify(name, { lower: true, strict: true });
    if (!slug) return fail(res, 400, 'Invalid category name');

    const exists = await Category.findOne({ slug });
    if (exists) return fail(res, 409, 'Category already exists');

    const created = await Category.create({
      name,
      slug,
      description: String(req.body?.description || ''),
      parent: req.body?.parent || null,
      displayOrder: Number(req.body?.displayOrder) || 0,
      isActive: !!req.body?.isActive,
      createdByStaff: req.staff.id
    });

    return ok(res, created, 201);
  } catch (err) {
    return fail(res, 500, 'Failed to create category');
  }
});

router.put('/categories/:id', isStaff, hasPermission('manageCategories'), async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) return fail(res, 404, 'Category not found');

    if (String(category.createdByStaff || '') !== String(req.staff.id)) {
      return fail(res, 403, 'Not allowed');
    }

    Object.assign(category, {
      name: req.body?.name || category.name,
      description: req.body?.description || category.description,
      displayOrder: Number(req.body?.displayOrder) || category.displayOrder,
      isActive: req.body?.isActive ?? category.isActive
    });

    await category.save();
    return ok(res, category);
  } catch (err) {
    return fail(res, 500, 'Failed to update category');
  }
});

router.delete('/categories/:id', isStaff, hasPermission('manageCategories'), async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) return fail(res, 404, 'Category not found');

    if (String(category.createdByStaff || '') !== String(req.staff.id)) {
      return fail(res, 403, 'Not allowed');
    }

    const count = await Product.countDocuments({ category: category._id });
    if (count > 0) {
      return fail(res, 400, 'Category is in use by products');
    }

    await Category.deleteOne({ _id: category._id });
    return ok(res, { id: category._id });
  } catch (err) {
    return fail(res, 500, 'Failed to delete category');
  }
});

module.exports = router;