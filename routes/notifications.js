const express = require('express');
const rateLimit = require('express-rate-limit');
const { attachJwtUserSilent } = require('../middleware/jwtAuth');
const { requireJwtAuth } = require('../middleware/jwtAuth');
const { requireAdmin } = require('../middleware/isAdmin');
const {
  validateSubscriptionObject,
  saveSubscription,
  unsubscribeByEndpoint,
  getSubscriptionStatus,
  getOrCreatePreferences,
  sendPushToUser,
  sendPushToGuests,
  clientIpFromRequest,
  isPushConfigured
} = require('../services/pushNotificationService');
const { getPublicVapidKey } = require('../lib/pushVapid');
const NotificationPromptLog = require('../models/NotificationPromptLog');
const { PROMPT_CHOICES } = require('../models/NotificationPromptLog');

const router = express.Router();

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many notification requests. Try again shortly.' }
});

function ok(res, data, message) {
  res.json({ success: true, message, data });
}

function fail(res, status, message) {
  res.status(status).json({ success: false, message });
}

/** GET /api/notifications/vapid-public-key — public VAPID key for subscribe */
router.get('/vapid-public-key', (req, res) => {
  const publicKey = getPublicVapidKey();
  if (!publicKey) {
    return fail(res, 503, 'Push notifications are not configured on the server');
  }
  ok(res, { publicKey });
});

/** POST /api/notifications/prompt-response — log Allow / Not now (no login) */
router.post('/prompt-response', attachJwtUserSilent, writeLimiter, async (req, res) => {
  try {
    const choice = String(req.body?.choice || '').toLowerCase();
    if (!PROMPT_CHOICES.includes(choice)) {
      return fail(res, 400, `choice must be one of: ${PROMPT_CHOICES.join(', ')}`);
    }
    const doc = await NotificationPromptLog.create({
      choice,
      guestKey: String(req.body?.guestKey || '').trim().slice(0, 120),
      user: req.authUserId || null,
      clientIp: clientIpFromRequest(req),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
      pageUrl: String(req.body?.pageUrl || '').trim().slice(0, 500),
      browserPermission: String(req.body?.browserPermission || '').slice(0, 32),
      subscribed: Boolean(req.body?.subscribed)
    });
    ok(res, { id: doc._id }, 'Recorded');
  } catch (err) {
    console.error('[notifications] prompt-response:', err);
    fail(res, 500, err.message || 'Failed to record response');
  }
});

/** GET /api/notifications/status — guest or logged-in */
router.get('/status', attachJwtUserSilent, async (req, res) => {
  try {
    const endpoint = String(req.query?.endpoint || '').trim();
    const status = await getSubscriptionStatus(req.authUserId || null, endpoint);
    ok(res, {
      ...status,
      pushConfigured: isPushConfigured()
    });
  } catch (err) {
    console.error('[notifications] status:', err);
    fail(res, 500, err.message || 'Failed to load status');
  }
});

/** POST /api/notifications/subscribe — no login required */
router.post('/subscribe', attachJwtUserSilent, writeLimiter, async (req, res) => {
  try {
    if (!isPushConfigured()) {
      return fail(res, 503, 'Push notifications are not configured');
    }
    const subscription = req.body?.subscription || req.body;
    if (!validateSubscriptionObject(subscription)) {
      return fail(res, 400, 'Invalid subscription payload');
    }
    const guestKey = String(req.body?.guestKey || '').trim();
    const doc = await saveSubscription(req.authUserId || null, subscription, {
      userAgent: req.headers['user-agent'],
      guestKey,
      clientIp: clientIpFromRequest(req)
    });
    ok(
      res,
      { id: doc._id, subscribed: true, isGuest: !req.authUserId },
      'Subscribed to notifications'
    );
  } catch (err) {
    console.error('[notifications] subscribe:', err);
    fail(res, 500, err.message || 'Subscribe failed');
  }
});

/** POST /api/notifications/unsubscribe — guest or logged-in */
router.post('/unsubscribe', attachJwtUserSilent, writeLimiter, async (req, res) => {
  try {
    const endpoint = req.body?.endpoint;
    const result = await unsubscribeByEndpoint(endpoint, req.authUserId || null);
    ok(res, result, 'Unsubscribed');
  } catch (err) {
    console.error('[notifications] unsubscribe:', err);
    fail(res, 500, err.message || 'Unsubscribe failed');
  }
});

/** GET /api/notifications/preferences — logged-in only */
router.get('/preferences', requireJwtAuth, async (req, res) => {
  try {
    const prefs = await getOrCreatePreferences(req.authUserId);
    ok(res, {
      favoriteCategoryIds: (prefs.favoriteCategoryIds || []).map(String),
      priceAlertsEnabled: prefs.priceAlertsEnabled !== false,
      orderUpdatesEnabled: prefs.orderUpdatesEnabled !== false,
      dealsEnabled: prefs.dealsEnabled !== false
    });
  } catch (err) {
    fail(res, 500, err.message || 'Failed to load preferences');
  }
});

/** PATCH /api/notifications/preferences */
router.patch('/preferences', requireJwtAuth, writeLimiter, async (req, res) => {
  try {
    const prefs = await getOrCreatePreferences(req.authUserId);
    const b = req.body || {};
    if (Array.isArray(b.favoriteCategoryIds)) {
      prefs.favoriteCategoryIds = b.favoriteCategoryIds.filter(Boolean).map(String);
    }
    if (b.priceAlertsEnabled != null) prefs.priceAlertsEnabled = Boolean(b.priceAlertsEnabled);
    if (b.orderUpdatesEnabled != null) prefs.orderUpdatesEnabled = Boolean(b.orderUpdatesEnabled);
    if (b.dealsEnabled != null) prefs.dealsEnabled = Boolean(b.dealsEnabled);
    await prefs.save();
    ok(res, {
      favoriteCategoryIds: prefs.favoriteCategoryIds.map(String),
      priceAlertsEnabled: prefs.priceAlertsEnabled,
      orderUpdatesEnabled: prefs.orderUpdatesEnabled,
      dealsEnabled: prefs.dealsEnabled
    }, 'Preferences saved');
  } catch (err) {
    fail(res, 500, err.message || 'Failed to save preferences');
  }
});

/**
 * POST /api/notifications/send-notification — admin test
 * Body: { userId?, title, body, url?, broadcastToGuests? }
 */
router.post('/send-notification', requireJwtAuth, requireAdmin, writeLimiter, async (req, res) => {
  try {
    const { userId, title, body, url, broadcastToGuests } = req.body || {};
    if (!title) {
      return fail(res, 400, 'title is required');
    }
    const { absoluteUrl } = require('../services/pushNotificationService');
    const payload = {
      title: String(title),
      body: String(body || ''),
      icon: absoluteUrl('/favicon.svg'),
      data: { url: absoluteUrl(url || '/shop'), type: 'admin' }
    };

    if (broadcastToGuests) {
      const result = await sendPushToGuests(payload, { type: 'admin' });
      return ok(res, result, 'Broadcast sent to guest subscribers');
    }

    if (!userId) {
      return fail(res, 400, 'userId is required (or set broadcastToGuests: true)');
    }

    const result = await sendPushToUser(userId, payload, { type: 'admin', skipPreferenceCheck: true });
    ok(res, result, 'Notification queued');
  } catch (err) {
    console.error('[notifications] send:', err);
    fail(res, 500, err.message || 'Send failed');
  }
});

module.exports = router;
