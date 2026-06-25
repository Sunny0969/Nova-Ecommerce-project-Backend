const express = require('express');
const NotificationPromptLog = require('../../models/NotificationPromptLog');
const UserPushSubscription = require('../../models/UserPushSubscription');

const router = express.Router();

function ok(res, data, status = 200) {
  res.status(status).json({ success: true, data });
}

function fail(res, status, message) {
  res.status(status).json({ success: false, message });
}

function shortUserAgent(ua) {
  const s = String(ua || '');
  if (!s) return 'Unknown';
  if (/iPhone|iPad|iPod/i.test(s)) return 'iOS';
  if (/Android/i.test(s)) return 'Android';
  if (/Edg\//i.test(s)) return 'Edge';
  if (/Chrome\//i.test(s)) return 'Chrome';
  if (/Firefox\//i.test(s)) return 'Firefox';
  if (/Safari\//i.test(s)) return 'Safari';
  return s.slice(0, 48);
}

/**
 * GET /api/admin/notifications/stats
 */
router.get('/stats', async (req, res) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [allowed, dismissed, denied, todayAllowed, todayDismissed, activeSubs, guestSubs, linkedSubs] =
      await Promise.all([
        NotificationPromptLog.countDocuments({ choice: 'allowed' }),
        NotificationPromptLog.countDocuments({ choice: 'dismissed' }),
        NotificationPromptLog.countDocuments({ choice: 'denied' }),
        NotificationPromptLog.countDocuments({ choice: 'allowed', createdAt: { $gte: startOfDay } }),
        NotificationPromptLog.countDocuments({ choice: 'dismissed', createdAt: { $gte: startOfDay } }),
        UserPushSubscription.countDocuments({ isActive: true }),
        UserPushSubscription.countDocuments({ isActive: true, isGuest: true }),
        UserPushSubscription.countDocuments({ isActive: true, isGuest: false, user: { $ne: null } })
      ]);

    ok(res, {
      allowed,
      dismissed,
      denied,
      todayAllowed,
      todayDismissed,
      activeSubscriptions: activeSubs,
      guestSubscriptions: guestSubs,
      memberSubscriptions: linkedSubs
    });
  } catch (err) {
    console.error('[admin notifications] stats:', err);
    fail(res, 500, err.message || 'Failed to load stats');
  }
});

/**
 * GET /api/admin/notifications/prompt-logs
 * Query: page, limit, choice (allowed|dismissed|denied|all), search (guestKey, ip)
 */
router.get('/prompt-logs', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const skip = (page - 1) * limit;
    const choice = String(req.query.choice || 'all').toLowerCase();
    const search = String(req.query.search || '').trim();

    const filter = {};
    if (choice !== 'all' && ['allowed', 'dismissed', 'denied'].includes(choice)) {
      filter.choice = choice;
    }
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ guestKey: rx }, { clientIp: rx }, { pageUrl: rx }];
    }

    const [rows, totalCount] = await Promise.all([
      NotificationPromptLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'name email')
        .lean(),
      NotificationPromptLog.countDocuments(filter)
    ]);

    const logs = rows.map((row) => ({
      _id: row._id,
      choice: row.choice,
      guestKey: row.guestKey || '',
      clientIp: row.clientIp || '',
      pageUrl: row.pageUrl || '',
      browserPermission: row.browserPermission || '',
      subscribed: Boolean(row.subscribed),
      device: shortUserAgent(row.userAgent),
      userAgent: row.userAgent || '',
      createdAt: row.createdAt,
      user: row.user
        ? {
            _id: row.user._id,
            name: row.user.name || '',
            email: row.user.email || ''
          }
        : null
    }));

    ok(res, {
      logs,
      totalCount,
      totalPages: Math.ceil(totalCount / limit) || 0,
      currentPage: page
    });
  } catch (err) {
    console.error('[admin notifications] prompt-logs:', err);
    fail(res, 500, err.message || 'Failed to load logs');
  }
});

/**
 * GET /api/admin/notifications/subscribers — active push endpoints
 */
router.get('/subscribers', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const skip = (page - 1) * limit;
    const type = String(req.query.type || 'all');

    const filter = { isActive: true };
    if (type === 'guest') filter.isGuest = true;
    if (type === 'member') filter.isGuest = false;

    const [rows, totalCount] = await Promise.all([
      UserPushSubscription.find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'name email')
        .lean(),
      UserPushSubscription.countDocuments(filter)
    ]);

    const subscribers = rows.map((row) => ({
      _id: row._id,
      endpoint: row.endpoint ? `${String(row.endpoint).slice(0, 48)}…` : '',
      isGuest: Boolean(row.isGuest),
      guestKey: row.guestKey || '',
      clientIp: row.clientIp || '',
      device: shortUserAgent(row.userAgent),
      userAgent: row.userAgent || '',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      user: row.user
        ? { _id: row.user._id, name: row.user.name, email: row.user.email }
        : null
    }));

    ok(res, {
      subscribers,
      totalCount,
      totalPages: Math.ceil(totalCount / limit) || 0,
      currentPage: page
    });
  } catch (err) {
    console.error('[admin notifications] subscribers:', err);
    fail(res, 500, err.message || 'Failed to load subscribers');
  }
});

module.exports = router;
