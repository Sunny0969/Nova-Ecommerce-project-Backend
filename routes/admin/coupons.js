/**
 * Admin coupon APIs — `requireAdmin` on mount in server.js.
 */

const express = require('express');
const mongoose = require('mongoose');
const Coupon = require('../../models/Coupon');
const Cart = require('../../models/Cart');

const router = express.Router();

function ok(res, status, payload) {
  res.status(status).json({ success: true, ...payload });
}

function fail(res, status, message, errors) {
  const body = { success: false, message };
  if (errors && Object.keys(errors).length) body.errors = errors;
  res.status(status).json(body);
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function parseExpiresAt(v) {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

function normalizeAppliesTo(raw, fallback) {
  const base = fallback || { type: 'all', categories: [], products: [] };
  if (!raw || typeof raw !== 'object') return base;
  const type = ['all', 'category', 'product'].includes(raw.type)
    ? raw.type
    : base.type;
  const categories = Array.isArray(raw.categories)
    ? raw.categories.filter((id) => isValidObjectId(String(id)))
    : base.categories;
  const products = Array.isArray(raw.products)
    ? raw.products.filter((id) => isValidObjectId(String(id)))
    : base.products;
  return { type, categories, products };
}

function validateDiscount(discountType, discountValue) {
  const t = discountType === 'percentage' ? 'percentage' : 'fixed';
  const v = Number(discountValue);
  if (!Number.isFinite(v) || v < 0) {
    return 'discountValue must be a non-negative number';
  }
  if (t === 'percentage' && v > 100) {
    return 'Percentage discount cannot exceed 100';
  }
  return null;
}

function buildCouponPayload(body, { isCreate }) {
  const errors = {};
  if (isCreate) {
    if (body.code == null || !String(body.code).trim()) {
      errors.code = 'Required';
    }
  }
  if (body.discountType != null && !['percentage', 'fixed'].includes(body.discountType)) {
    errors.discountType = 'Must be percentage or fixed';
  }
  if (isCreate && body.discountType == null) {
    errors.discountType = 'Required';
  }
  if (isCreate && body.discountValue == null) {
    errors.discountValue = 'Required';
  }

  const discountType = body.discountType;
  const discountValue = body.discountValue;
  if (discountType != null || discountValue != null) {
    const dt = discountType || 'percentage';
    const err = validateDiscount(dt, discountValue ?? 0);
    if (err) errors.discountValue = err;
  }

  if (Object.keys(errors).length) return { errors };

  const payload = {};

  if (body.code != null && String(body.code).trim()) {
    payload.code = String(body.code).trim();
  }

  if (body.discountType != null) payload.discountType = body.discountType;
  if (body.discountValue != null) payload.discountValue = Number(body.discountValue);

  if (body.minOrderAmount != null) {
    const m = Number(body.minOrderAmount);
    payload.minOrderAmount = Number.isFinite(m) && m >= 0 ? m : 0;
  }

  if ('maxUses' in body) {
    if (body.maxUses === null || body.maxUses === '') {
      payload.maxUses = null;
    } else {
      const n = Number(body.maxUses);
      payload.maxUses = Number.isFinite(n) && n >= 0 ? n : 0;
    }
  }

  if ('perCustomerLimit' in body) {
    if (body.perCustomerLimit === null || body.perCustomerLimit === '') {
      payload.perCustomerLimit = null;
    } else {
      const n = parseInt(body.perCustomerLimit, 10);
      payload.perCustomerLimit = Number.isFinite(n) && n >= 1 ? n : null;
    }
  }

  if ('expiresAt' in body) {
    const exp = parseExpiresAt(body.expiresAt);
    if (exp === undefined) {
      return { errors: { expiresAt: 'Invalid date' } };
    }
    payload.expiresAt = exp;
  }

  if (typeof body.isActive === 'boolean') {
    payload.isActive = body.isActive;
  }

  if (body.appliesTo != null) {
    payload.appliesTo = normalizeAppliesTo(body.appliesTo);
  }

  return { payload };
}

/**
 * GET /api/admin/coupons
 */
router.get('/', async (req, res) => {
  try {
    const coupons = await Coupon.find()
      .sort({ createdAt: -1 })
      .populate({ path: 'appliesTo.categories', select: 'name slug' })
      .populate({ path: 'appliesTo.products', select: 'name slug price' })
      .lean();

    return ok(res, 200, { data: { coupons } });
  } catch (error) {
    console.error('Admin list coupons error:', error);
    return fail(res, 500, error.message || 'Failed to list coupons');
  }
});

/**
 * POST /api/admin/coupons
 */
router.post('/', async (req, res) => {
  try {
    const built = buildCouponPayload(req.body, { isCreate: true });
    if (built.errors) {
      return fail(res, 400, 'Invalid coupon data', built.errors);
    }

    const { payload } = built;
    const doc = new Coupon({
      code: payload.code,
      discountType: payload.discountType,
      discountValue: payload.discountValue,
      minOrderAmount: payload.minOrderAmount ?? 0,
      maxUses: payload.maxUses ?? null,
      perCustomerLimit: payload.perCustomerLimit ?? null,
      expiresAt: payload.expiresAt ?? null,
      isActive: payload.isActive !== undefined ? payload.isActive : true,
      appliesTo: payload.appliesTo || normalizeAppliesTo(req.body.appliesTo)
    });

    await doc.save();
    const populated = await Coupon.findById(doc._id)
      .populate({ path: 'appliesTo.categories', select: 'name slug' })
      .populate({ path: 'appliesTo.products', select: 'name slug price' })
      .lean();

    return ok(res, 201, { message: 'Coupon created', data: { coupon: populated } });
  } catch (error) {
    if (error.code === 11000) {
      return fail(res, 409, 'A coupon with this code already exists');
    }
    if (error.name === 'ValidationError') {
      const errors = Object.fromEntries(
        Object.values(error.errors || {}).map((e) => [e.path || 'field', e.message])
      );
      return fail(res, 400, 'Validation failed', errors);
    }
    console.error('Admin create coupon error:', error);
    return fail(res, 500, error.message || 'Failed to create coupon');
  }
});

/**
 * PATCH /api/admin/coupons/:id/toggle — activate / deactivate
 */
router.patch('/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return fail(res, 400, 'Invalid coupon id');
    }

    const coupon = await Coupon.findById(id);
    if (!coupon) {
      return fail(res, 404, 'Coupon not found');
    }

    coupon.isActive = !coupon.isActive;
    await coupon.save();

    const populated = await Coupon.findById(coupon._id)
      .populate({ path: 'appliesTo.categories', select: 'name slug' })
      .populate({ path: 'appliesTo.products', select: 'name slug price' })
      .lean();

    return ok(res, 200, {
      message: coupon.isActive ? 'Coupon activated' : 'Coupon deactivated',
      data: { coupon: populated }
    });
  } catch (error) {
    console.error('Admin toggle coupon error:', error);
    return fail(res, 500, error.message || 'Failed to update coupon');
  }
});

/**
 * PUT /api/admin/coupons/:id
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return fail(res, 400, 'Invalid coupon id');
    }

    const coupon = await Coupon.findById(id);
    if (!coupon) {
      return fail(res, 404, 'Coupon not found');
    }

    const built = buildCouponPayload(req.body, { isCreate: false });
    if (built.errors) {
      return fail(res, 400, 'Invalid coupon data', built.errors);
    }

    const { payload } = built;
    if (payload.code != null) coupon.code = payload.code;
    if (payload.discountType != null) coupon.discountType = payload.discountType;
    if (payload.discountValue != null) coupon.discountValue = payload.discountValue;
    if (payload.minOrderAmount != null) coupon.minOrderAmount = payload.minOrderAmount;
    if ('maxUses' in payload) coupon.maxUses = payload.maxUses;
    if ('perCustomerLimit' in payload) coupon.perCustomerLimit = payload.perCustomerLimit;
    if ('expiresAt' in payload) coupon.expiresAt = payload.expiresAt;
    if (typeof payload.isActive === 'boolean') coupon.isActive = payload.isActive;
    if (payload.appliesTo) {
      coupon.appliesTo = normalizeAppliesTo(payload.appliesTo, coupon.appliesTo);
    }

    const err = validateDiscount(coupon.discountType, coupon.discountValue);
    if (err) {
      return fail(res, 400, err, { discountValue: err });
    }

    await coupon.save();

    const populated = await Coupon.findById(coupon._id)
      .populate({ path: 'appliesTo.categories', select: 'name slug' })
      .populate({ path: 'appliesTo.products', select: 'name slug price' })
      .lean();

    return ok(res, 200, { message: 'Coupon updated', data: { coupon: populated } });
  } catch (error) {
    if (error.code === 11000) {
      return fail(res, 409, 'A coupon with this code already exists');
    }
    if (error.name === 'ValidationError') {
      const errors = Object.fromEntries(
        Object.values(error.errors || {}).map((e) => [e.path || 'field', e.message])
      );
      return fail(res, 400, 'Validation failed', errors);
    }
    console.error('Admin update coupon error:', error);
    return fail(res, 500, error.message || 'Failed to update coupon');
  }
});

/**
 * DELETE /api/admin/coupons/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return fail(res, 400, 'Invalid coupon id');
    }

    const coupon = await Coupon.findById(id);
    if (!coupon) {
      return fail(res, 404, 'Coupon not found');
    }

    await Cart.updateMany(
      { coupon: id },
      { $set: { coupon: null, discountAmount: 0 } }
    );
    await Coupon.deleteOne({ _id: id });

    return ok(res, 200, {
      message: 'Coupon deleted',
      data: { deletedId: id }
    });
  } catch (error) {
    console.error('Admin delete coupon error:', error);
    return fail(res, 500, error.message || 'Failed to delete coupon');
  }
});

module.exports = router;
