const express = require('express');
const mongoose = require('mongoose');
const UserEvent = require('../models/UserEvent');
const { attachJwtUserSilent } = require('../middleware/jwtAuth');

const router = express.Router();

function ok(res, data, status = 200, extra = {}) {
  res.status(status).json({ success: true, data, ...extra });
}

function fail(res, status, message, errors) {
  const body = { success: false, message };
  if (errors && Object.keys(errors).length) body.errors = errors;
  res.status(status).json(body);
}

function clientIpFromReq(req) {
  const xff = req?.headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim();
  return (req?.ip && String(req.ip)) || '';
}

/**
 * POST /api/events — logs product interaction events.
 * No auth required (uses sessionId for guests). If JWT is present, attaches userId.
 *
 * body:
 *  - sessionId: string (recommended)
 *  - productId: string (ObjectId)
 *  - eventType: view/add_to_cart/purchase/wishlist/share
 *  - duration: number seconds (optional)
 *  - source: search/category/recommendation/... (optional)
 */
router.post('/', attachJwtUserSilent, async (req, res) => {
  try {
    const b = req.body || {};
    const errors = {};

    const productId = b.productId != null ? String(b.productId).trim() : '';
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      errors.productId = 'Valid productId is required';
    }

    const eventType = b.eventType != null ? String(b.eventType).trim() : '';
    const allowed = ['view', 'add_to_cart', 'purchase', 'wishlist', 'share'];
    if (!allowed.includes(eventType)) {
      errors.eventType = `eventType must be one of: ${allowed.join(', ')}`;
    }

    const sessionId = b.sessionId != null ? String(b.sessionId).trim().slice(0, 200) : '';
    if (!req.authUserId && !sessionId) {
      errors.sessionId = 'sessionId is required for guests';
    }

    const durationRaw = b.duration != null ? Number(b.duration) : 0;
    const duration = Number.isFinite(durationRaw) ? Math.max(0, Math.min(24 * 60 * 60, durationRaw)) : 0;

    const source = b.source != null ? String(b.source).trim().slice(0, 80) : '';

    if (Object.keys(errors).length) {
      return fail(res, 400, 'Invalid event', errors);
    }

    const doc = await UserEvent.create({
      userId: req.authUserId && mongoose.Types.ObjectId.isValid(req.authUserId) ? req.authUserId : null,
      sessionId,
      productId: new mongoose.Types.ObjectId(productId),
      eventType,
      duration,
      source
    });

    return ok(res, { id: doc._id }, 201, { message: 'Event logged' });
  } catch (error) {
    console.error('Event log error:', error);
    return fail(res, 500, error.message || 'Failed to log event');
  }
});

module.exports = router;

