const express = require('express');
const rateLimit = require('express-rate-limit');
const { sendWebsiteEvent, contextFromReq, isConfigured } = require('../services/metaConversions');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many tracking requests' }
});

function ok(res, payload) {
  res.json({ success: true, ...payload });
}

function fail(res, status, message) {
  res.status(status).json({ success: false, message });
}

/**
 * POST /api/meta/event — mirror browser pixel events server-side (CAPI + dedup).
 * Body: { eventName, eventId, eventSourceUrl, email?, phone?, customData?, fbc?, fbp? }
 */
router.post('/event', limiter, async (req, res) => {
  try {
    if (!isConfigured()) {
      return fail(res, 503, 'Meta Conversions API is not configured');
    }

    const eventName = String(req.body.eventName || '').trim();
    const eventId = String(req.body.eventId || '').trim();
    const eventSourceUrl = String(req.body.eventSourceUrl || '').trim();

    if (!eventName) {
      return fail(res, 400, 'eventName is required');
    }
    if (!eventSourceUrl) {
      return fail(res, 400, 'eventSourceUrl is required');
    }

    const userCtx = contextFromReq(req, req.body);
    const custom = req.body.customData && typeof req.body.customData === 'object' ? req.body.customData : {};

    const result = await sendWebsiteEvent({
      eventName,
      eventId: eventId || undefined,
      eventSourceUrl,
      userCtx,
      customData: custom
    });

    if (result.skipped) {
      return ok(res, { data: { skipped: true, reason: result.reason } });
    }
    if (!result.ok) {
      return fail(res, 502, 'Meta event delivery failed');
    }

    return ok(res, { data: { delivered: true, eventName, eventId: eventId || null } });
  } catch (error) {
    console.error('Meta event route error:', error);
    return fail(res, 500, error.message || 'Failed to send event');
  }
});

/** GET /api/meta/status — whether CAPI is configured (no secrets). */
router.get('/status', (req, res) => {
  ok(res, {
    data: {
      configured: isConfigured(),
      pixelId: '1519068336295914'
    }
  });
});

module.exports = router;
