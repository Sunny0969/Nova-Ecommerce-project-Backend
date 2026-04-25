/**
 * Staff access management — /api/admin/staff
 * Mounted behind admin auth (main admin only).
 */
const express = require('express');
const mongoose = require('mongoose');
const StaffAccess = require('../../models/StaffAccess');
const User = require('../../models/User');
const { sendMail } = require('../../lib/email');

const router = express.Router();

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function publicStaff(staffDoc) {
  if (!staffDoc) return null;
  const d = typeof staffDoc.toObject === 'function' ? staffDoc.toObject() : staffDoc;
  delete d.password;
  return d;
}

/**
 * POST /api/admin/staff/create
 * Body: { name, email, password, permissions }
 */
router.post('/create', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const permissions = req.body?.permissions && typeof req.body.permissions === 'object' ? req.body.permissions : {};

    if (!name) return fail(res, 400, 'Name is required');
    if (!email) return fail(res, 400, 'Email is required');
    if (!password || password.length < 6) {
      return fail(res, 400, 'Password must be at least 6 characters');
    }

    const existsUser = await User.exists({ email });
    if (existsUser) return fail(res, 409, 'A user with this email already exists');
    const existsStaff = await StaffAccess.exists({ email });
    if (existsStaff) return fail(res, 409, 'A staff member with this email already exists');

    const createdBy = req.authUserId && mongoose.Types.ObjectId.isValid(req.authUserId)
      ? req.authUserId
      : undefined;

    const staff = await StaffAccess.create({
      name,
      email,
      password,
      createdBy,
      permissions
    });

    const site = process.env.FRONTEND_URL || '';
    const staffLoginLink = site ? `${String(site).replace(/\/$/, '')}/staff-login` : '/staff-login';

    await sendMail({
      to: email,
      subject: 'You have been given access to Nova Shop Admin',
      text: [
        'You have been granted staff access to Nova Shop Admin.',
        '',
        `Email: ${email}`,
        `Password: ${password}`,
        '',
        `Login: ${staffLoginLink}`
      ].join('\n')
    });

    const safe = await StaffAccess.findById(staff._id)
      .select('name email status blockedUntil permissions lastLogin createdAt updatedAt createdBy')
      .lean();
    return ok(res, safe, 201);
  } catch (err) {
    if (err?.code === 11000) {
      return fail(res, 409, 'Duplicate email');
    }
    console.error('staff create:', err);
    return fail(res, 500, err.message || 'Failed to create staff');
  }
});

/**
 * GET /api/admin/staff
 * Return all staff members (no passwords).
 */
router.get('/', async (req, res) => {
  try {
    const rows = await StaffAccess.find()
      .select('name email status blockedUntil permissions lastLogin createdAt updatedAt createdBy')
      .sort({ createdAt: -1 })
      .lean();
    return ok(res, rows);
  } catch (err) {
    console.error('staff list:', err);
    return fail(res, 500, err.message || 'Failed to load staff');
  }
});

/**
 * PUT /api/admin/staff/:id/permissions
 */
router.put('/:id/permissions', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) return fail(res, 400, 'Invalid staff id');
    const permissions = req.body?.permissions && typeof req.body.permissions === 'object' ? req.body.permissions : {};

    const staff = await StaffAccess.findByIdAndUpdate(
      id,
      { $set: { permissions } },
      { new: true }
    )
      .select('name email status blockedUntil permissions lastLogin createdAt updatedAt createdBy')
      .lean();

    if (!staff) return fail(res, 404, 'Staff member not found');
    return ok(res, staff);
  } catch (err) {
    console.error('staff permissions:', err);
    return fail(res, 500, err.message || 'Failed to update permissions');
  }
});

/**
 * POST /api/admin/staff/:id/block
 * Body: { duration } duration in hours (0 = permanent)
 */
router.post('/:id/block', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) return fail(res, 400, 'Invalid staff id');
    const duration = Number(req.body?.duration ?? 0);
    const now = Date.now();
    const blockedUntil = duration > 0 ? new Date(now + duration * 60 * 60 * 1000) : null;

    const staff = await StaffAccess.findByIdAndUpdate(
      id,
      { $set: { status: 'blocked', blockedUntil } },
      { new: true }
    )
      .select('name email status blockedUntil permissions lastLogin createdAt updatedAt createdBy')
      .lean();
    if (!staff) return fail(res, 404, 'Staff member not found');
    return ok(res, staff);
  } catch (err) {
    console.error('staff block:', err);
    return fail(res, 500, err.message || 'Failed to block staff');
  }
});

/**
 * POST /api/admin/staff/:id/unblock
 */
router.post('/:id/unblock', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) return fail(res, 400, 'Invalid staff id');

    const staff = await StaffAccess.findByIdAndUpdate(
      id,
      { $set: { status: 'active', blockedUntil: null } },
      { new: true }
    )
      .select('name email status blockedUntil permissions lastLogin createdAt updatedAt createdBy')
      .lean();
    if (!staff) return fail(res, 404, 'Staff member not found');
    return ok(res, staff);
  } catch (err) {
    console.error('staff unblock:', err);
    return fail(res, 500, err.message || 'Failed to unblock staff');
  }
});

/**
 * DELETE /api/admin/staff/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) return fail(res, 400, 'Invalid staff id');
    const staff = await StaffAccess.findByIdAndDelete(id)
      .select('name email')
      .lean();
    if (!staff) return fail(res, 404, 'Staff member not found');
    return ok(res, { deleted: true, staff });
  } catch (err) {
    console.error('staff delete:', err);
    return fail(res, 500, err.message || 'Failed to delete staff');
  }
});

module.exports = router;

