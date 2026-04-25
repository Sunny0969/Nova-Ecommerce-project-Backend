/**
 * Staff auth endpoints — /api/staff/*
 */
const express = require('express');
const StaffAccess = require('../models/StaffAccess');
const Product = require('../models/Product');
const { isStaff } = require('../middleware/staffAuth');

const router = express.Router();

function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * POST /api/staff/login
 * Body: { email, password }
 */
router.post('/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    if (!email || !password) {
      return fail(res, 400, 'Email and password are required');
    }

    const staff = await StaffAccess.findOne({ email }).select('+password name email status blockedUntil permissions');
    if (!staff) {
      return fail(res, 404, 'Staff account not found');
    }

    if (staff.status === 'blocked') {
      const until = staff.blockedUntil ? new Date(staff.blockedUntil).getTime() : null;
      if (until && until <= Date.now()) {
        staff.status = 'active';
        staff.blockedUntil = null;
      } else {
        return res.status(403).json({ success: false, message: 'Your access has been blocked' });
      }
    }

    const ok = await staff.comparePassword(password);
    if (!ok) {
      return fail(res, 401, 'Incorrect password');
    }

    staff.lastLogin = new Date();
    await staff.save();

    const token = staff.getJWTToken();

    return res.json({
      success: true,
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
    console.error('staff login:', err);
    return fail(res, 500, err.message || 'Login failed');
  }
});

/**
 * GET /api/staff/me — verify staff token + status, return staff info and permissions.
 */
router.get('/me', isStaff, async (req, res) => {
  return res.json({
    success: true,
    data: {
      staff: { id: req.staff.id, name: req.staff.name, email: req.staff.email, role: 'staff' },
      permissions: req.staff.permissions,
      status: 'active'
    }
  });
});

/**
 * GET /api/staff/products — staff’s submitted products
 */
router.get('/products', isStaff, async (req, res) => {
  try {
    const rows = await Product.find({ submittedByStaff: req.staff.id })
      .select('name slug approvalStatus rejectionReason isPublished createdAt updatedAt')
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean();
    return res.json({ success: true, data: rows });
  } catch (e) {
    console.error('staff products:', e);
    return fail(res, 500, e.message || 'Failed to load products');
  }
});

module.exports = router;

