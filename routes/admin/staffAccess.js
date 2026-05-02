/**
 * Staff access management — /api/admin/staff
 * Mount: app.use('/api/admin/staff', requireJwtAuth, requireAdmin, require('./routes/admin/staffAccess'));
 */
const express = require('express');
const mongoose = require('mongoose');
const StaffAccess = require('../../models/StaffAccess');
const User = require('../../models/User');

const router = express.Router();

// Email send karna optional hai — agar module exist na kare to crash nahi hoga
let sendMail = null;
try {
  const emailLib = require('../../lib/email');
  sendMail = emailLib.sendMail || emailLib.default || null;
} catch (e) {
  console.warn('[staffAccess] Email module not available — emails will be skipped:', e.message);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/staff
 * List all staff members
 */
router.get('/', async (req, res) => {
  try {
    const staffMembers = await StaffAccess.find()
      .select('-password')
      .sort({ createdAt: -1 })
      .lean();
    return ok(res, staffMembers);
  } catch (err) {
    console.error('[staffAccess] GET / error:', err);
    return fail(res, 500, 'Failed to load staff list');
  }
});

/**
 * POST /api/admin/staff/create
 * Body: { name, email, password, permissions }
 */
router.post('/create', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const permissions = req.body?.permissions || {};

    // Validation
    if (!name?.trim()) return fail(res, 400, 'Name is required');
    if (!email?.trim()) return fail(res, 400, 'Email is required');
    if (!password || String(password).length < 6) {
      return fail(res, 400, 'Password must be at least 6 characters');
    }

    const emailLower = email.trim().toLowerCase();

    // Duplicate check — User collection
    const existsUser = await User.exists({ email: emailLower });
    if (existsUser) return fail(res, 409, 'A user with this email already exists');

    // Duplicate check — StaffAccess collection
    const existsStaff = await StaffAccess.exists({ email: emailLower });
    if (existsStaff) return fail(res, 409, 'A staff member with this email already exists');

    // Create staff member (password hashing is done by pre-save hook in model)
    const staff = await StaffAccess.create({
      name: name.trim(),
      email: emailLower,
      password,
      createdBy: req.authUserId || req.userId || req.user?._id || null,
      permissions: {
        manageProducts:   !!permissions.manageProducts,
        manageCategories: !!permissions.manageCategories,
        manageOrders:     !!permissions.manageOrders,
        manageBlog:       !!permissions.manageBlog,
        manageCustomers:  !!permissions.manageCustomers,
        viewAnalytics:    !!permissions.viewAnalytics,
        manageCoupons:    !!permissions.manageCoupons
      }
    });

    // Optional: send welcome email (won't crash if it fails)
    if (typeof sendMail === 'function') {
      try {
        const site = process.env.FRONTEND_URL || 'http://localhost:3000';
        await sendMail({
          to: emailLower,
          subject: 'Nova Shop — Staff Access Granted',
          text: [
            `Hello ${name.trim()},`,
            '',
            'You have been added as a staff member at Nova Shop.',
            `Email:    ${emailLower}`,
            `Password: ${password}`,
            `Login:    ${site}/staff-login`
          ].join('\n')
        });
      } catch (mailErr) {
        console.warn('[staffAccess] Email send failed (staff still created):', mailErr.message);
      }
    }

    const result = await StaffAccess.findById(staff._id).select('-password').lean();
    return ok(res, result, 201);

  } catch (err) {
    console.error('[staffAccess] POST /create error:', err);
    // MongoDB duplicate key error
    if (err.code === 11000) {
      return fail(res, 409, 'A staff member with this email already exists');
    }
    return fail(res, 500, err.message || 'Failed to create staff member');
  }
});

/**
 * PUT /api/admin/staff/:id/permissions
 * Body: { permissions: { manageProducts, ... } }
 */
router.put('/:id/permissions', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return fail(res, 400, 'Invalid staff ID');

    const permissions = req.body?.permissions || {};

    const updated = await StaffAccess.findByIdAndUpdate(
      id,
      {
        $set: {
          'permissions.manageProducts':   !!permissions.manageProducts,
          'permissions.manageCategories': !!permissions.manageCategories,
          'permissions.manageOrders':     !!permissions.manageOrders,
          'permissions.manageBlog':       !!permissions.manageBlog,
          'permissions.manageCustomers':  !!permissions.manageCustomers,
          'permissions.viewAnalytics':    !!permissions.viewAnalytics,
          'permissions.manageCoupons':    !!permissions.manageCoupons
        }
      },
      { new: true, runValidators: true }
    ).select('-password').lean();

    if (!updated) return fail(res, 404, 'Staff member not found');
    return ok(res, updated);

  } catch (err) {
    console.error('[staffAccess] PUT /:id/permissions error:', err);
    return fail(res, 500, err.message || 'Failed to update permissions');
  }
});

/**
 * POST /api/admin/staff/:id/block
 * Body: { duration: number (hours, 0 = permanent) }
 */
router.post('/:id/block', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return fail(res, 400, 'Invalid staff ID');

    const durationHours = Number(req.body?.duration ?? 24);
    const blockedUntil = durationHours > 0
      ? new Date(Date.now() + durationHours * 60 * 60 * 1000)
      : null; // null = permanent

    const updated = await StaffAccess.findByIdAndUpdate(
      id,
      { $set: { status: 'blocked', blockedUntil } },
      { new: true }
    ).select('-password').lean();

    if (!updated) return fail(res, 404, 'Staff member not found');
    return ok(res, updated);

  } catch (err) {
    console.error('[staffAccess] POST /:id/block error:', err);
    return fail(res, 500, err.message || 'Failed to block staff');
  }
});

/**
 * POST /api/admin/staff/:id/unblock
 */
router.post('/:id/unblock', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return fail(res, 400, 'Invalid staff ID');

    const updated = await StaffAccess.findByIdAndUpdate(
      id,
      { $set: { status: 'active', blockedUntil: null } },
      { new: true }
    ).select('-password').lean();

    if (!updated) return fail(res, 404, 'Staff member not found');
    return ok(res, updated);

  } catch (err) {
    console.error('[staffAccess] POST /:id/unblock error:', err);
    return fail(res, 500, err.message || 'Failed to unblock staff');
  }
});

/**
 * DELETE /api/admin/staff/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return fail(res, 400, 'Invalid staff ID');

    const deleted = await StaffAccess.findByIdAndDelete(id).lean();
    if (!deleted) return fail(res, 404, 'Staff member not found');
    return ok(res, { _id: id, deleted: true });

  } catch (err) {
    console.error('[staffAccess] DELETE /:id error:', err);
    return fail(res, 500, err.message || 'Failed to remove staff');
  }
});

module.exports = router;