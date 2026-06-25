const UserPushSubscription = require('../models/UserPushSubscription');
const NotificationLog = require('../models/NotificationLog');
const UserNotificationPreferences = require('../models/UserNotificationPreferences');
const Wishlist = require('../models/Wishlist');
const { configureWebPush, isPushConfigured, webpush } = require('../lib/pushVapid');

const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://www.bazaar-pk.com').replace(/\/$/, '');

function absoluteUrl(path = '/') {
  const p = String(path || '/').startsWith('/') ? path : `/${path}`;
  return `${FRONTEND_URL}${p}`;
}

function buildProductPath(slug, categorySlug) {
  const s = String(slug || '').trim();
  if (!s) return '/shop';
  const cat = String(categorySlug || '').trim();
  if (cat) return `/${encodeURIComponent(cat)}/${encodeURIComponent(s)}`;
  return `/shop/${encodeURIComponent(s)}`;
}

function validateSubscriptionObject(sub) {
  if (!sub || typeof sub !== 'object') return false;
  const endpoint = String(sub.endpoint || '').trim();
  const keys = sub.keys;
  if (!endpoint || !keys || typeof keys !== 'object') return false;
  if (!keys.p256dh || !keys.auth) return false;
  return true;
}

async function logNotification({ userId, title, body, type, status, meta }) {
  try {
    await NotificationLog.create({
      user: userId || undefined,
      title: String(title || '').slice(0, 200),
      body: String(body || '').slice(0, 500),
      type: type || 'general',
      status: status || 'sent',
      meta: meta || null
    });
  } catch (err) {
    console.warn('[push] log failed:', err.message);
  }
}

async function deactivateSubscription(id) {
  try {
    await UserPushSubscription.updateOne({ _id: id }, { $set: { isActive: false } });
  } catch (err) {
    console.warn('[push] deactivate failed:', err.message);
  }
}

async function sendToSubscriptionDoc(doc, payload) {
  if (!doc?.isActive || !doc.subscription) {
    return { ok: false, reason: 'inactive' };
  }
  if (!configureWebPush()) {
    return { ok: false, reason: 'not_configured' };
  }

  const body = JSON.stringify(payload);
  try {
    await webpush.sendNotification(doc.subscription, body);
    return { ok: true };
  } catch (err) {
    const status = err?.statusCode || err?.status;
    if (status === 404 || status === 410) {
      await deactivateSubscription(doc._id);
      return { ok: false, reason: 'gone', status };
    }
    console.warn('[push] send error:', status, err.message);
    return { ok: false, reason: err.message, status };
  }
}

async function sendPushToSubscriptions(subs, payload, { type = 'general', logUserId = null } = {}) {
  if (!subs?.length) return { sent: 0, failed: 0, skipped: true };

  const seen = new Set();
  let sent = 0;
  let failed = 0;

  for (const sub of subs) {
    const ep = sub.endpoint;
    if (!ep || seen.has(ep)) continue;
    seen.add(ep);
    const result = await sendToSubscriptionDoc(sub, payload);
    if (result.ok) sent += 1;
    else failed += 1;
  }

  await logNotification({
    userId: logUserId,
    title: payload.title,
    body: payload.body,
    type,
    status: sent > 0 ? 'sent' : 'failed',
    meta: { sent, failed, recipients: seen.size }
  });

  return { sent, failed, skipped: false, recipients: seen.size };
}

async function sendPushToUser(userId, payload, { type = 'general', skipPreferenceCheck = false } = {}) {
  if (!userId) return { sent: 0, failed: 0, skipped: true };

  if (!skipPreferenceCheck) {
    const prefs = await UserNotificationPreferences.findOne({ user: userId }).lean();
    if (type === 'price_drop' && prefs && prefs.priceAlertsEnabled === false) {
      await logNotification({
        userId,
        title: payload.title,
        body: payload.body,
        type,
        status: 'skipped',
        meta: { reason: 'prefs_off' }
      });
      return { sent: 0, failed: 0, skipped: true };
    }
    if (type === 'order' && prefs && prefs.orderUpdatesEnabled === false) {
      return { sent: 0, failed: 0, skipped: true };
    }
    if (type === 'deal' && prefs && prefs.dealsEnabled === false) {
      return { sent: 0, failed: 0, skipped: true };
    }
  }

  const subs = await UserPushSubscription.find({ user: userId, isActive: true }).lean();
  if (!subs.length) {
    return { sent: 0, failed: 0, skipped: true };
  }

  return sendPushToSubscriptions(subs, payload, { type, logUserId: userId });
}

async function sendPushToGuests(payload, { type = 'general' } = {}) {
  const subs = await UserPushSubscription.find({ isActive: true, isGuest: true }).lean();
  return sendPushToSubscriptions(subs, payload, { type });
}

async function getActiveGuestSubscriptions() {
  return UserPushSubscription.find({ isActive: true, isGuest: true }).lean();
}

function clientIpFromRequest(req) {
  const fwd = req?.headers?.['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim().slice(0, 64);
  return String(req?.ip || req?.socket?.remoteAddress || '').slice(0, 64);
}

async function saveSubscription(userId, subscription, meta = {}) {
  if (!validateSubscriptionObject(subscription)) {
    throw new Error('Invalid push subscription object');
  }
  const endpoint = String(subscription.endpoint).trim();
  const userAgent = String(meta.userAgent || '').slice(0, 500);
  const guestKey = String(meta.guestKey || '').trim().slice(0, 120);
  const clientIp = String(meta.clientIp || '').trim().slice(0, 64);

  const update = {
    endpoint,
    subscription,
    isActive: true,
    userAgent,
    guestKey,
    clientIp
  };

  if (userId) {
    update.user = userId;
    update.isGuest = false;
  } else {
    update.isGuest = true;
  }

  const doc = await UserPushSubscription.findOneAndUpdate({ endpoint }, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true
  });

  // Link other guest rows from same browser guestKey when user logs in
  if (userId && guestKey) {
    await UserPushSubscription.updateMany(
      { guestKey, endpoint: { $ne: endpoint }, isActive: true },
      { $set: { user: userId, isGuest: false } }
    );
  }

  return doc;
}

async function unsubscribeByEndpoint(endpoint, userId = null) {
  const ep = String(endpoint || '').trim();
  if (!ep) {
    return unsubscribeUser(userId, null);
  }
  const filter = { endpoint: ep, isActive: true };
  if (userId) filter.user = userId;
  const r = await UserPushSubscription.updateMany(filter, { $set: { isActive: false } });
  return { modified: r.modifiedCount };
}

async function unsubscribeUser(userId, endpoint) {
  if (endpoint) {
    return unsubscribeByEndpoint(endpoint, userId || null);
  }
  const filter = { isActive: true };
  if (userId) {
    filter.user = userId;
  } else {
    return { modified: 0 };
  }
  const r = await UserPushSubscription.updateMany(filter, { $set: { isActive: false } });
  return { modified: r.modifiedCount };
}

async function getSubscriptionStatus(userId, endpoint = '') {
  if (userId) {
    const count = await UserPushSubscription.countDocuments({ user: userId, isActive: true });
    return { subscribed: count > 0, deviceCount: count, isGuest: false };
  }
  const ep = String(endpoint || '').trim();
  if (ep) {
    const count = await UserPushSubscription.countDocuments({ endpoint: ep, isActive: true });
    return { subscribed: count > 0, deviceCount: count, isGuest: true };
  }
  return { subscribed: false, deviceCount: 0, isGuest: true };
}

async function getOrCreatePreferences(userId) {
  let doc = await UserNotificationPreferences.findOne({ user: userId });
  if (!doc) {
    doc = await UserNotificationPreferences.create({ user: userId });
  }
  return doc;
}

function formatPkr(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 'PKR —';
  return `Rs ${Math.round(n).toLocaleString('en-PK')}`;
}

async function notifyPriceChange(productId, productName, oldPrice, newPrice, productPath = '/shop') {
  if (!isPushConfigured()) return { skipped: true, reason: 'not_configured' };
  const newP = Number(newPrice);
  const oldP = Number(oldPrice);
  if (!Number.isFinite(newP) || !Number.isFinite(oldP) || newP >= oldP) {
    return { skipped: true, reason: 'not_a_drop' };
  }

  const wishlists = await Wishlist.find({ products: productId }).select('user').lean();
  const userIds = [...new Set(wishlists.map((w) => String(w.user)).filter(Boolean))];
  if (!userIds.length) return { sent: 0, users: 0 };

  const title = 'Price drop on your wishlist';
  const body = `${productName} is now ${formatPkr(newP)} (was ${formatPkr(oldP)})`;
  const payload = {
    title,
    body,
    icon: absoluteUrl('/favicon.svg'),
    badge: absoluteUrl('/favicon.svg'),
    tag: `price-${productId}`,
    data: { url: absoluteUrl(productPath), type: 'price_drop', productId: String(productId) }
  };

  let totalSent = 0;
  for (const uid of userIds) {
    const r = await sendPushToUser(uid, payload, { type: 'price_drop' });
    totalSent += r.sent || 0;
  }
  return { sent: totalSent, users: userIds.length };
}

async function notifyNewProduct(productId, categoryId, productName, productPath = '/shop') {
  if (!isPushConfigured() || !categoryId) return { skipped: true };

  const prefs = await UserNotificationPreferences.find({
    favoriteCategoryIds: categoryId
  })
    .select('user')
    .lean();

  const userIds = [...new Set(prefs.map((p) => String(p.user)).filter(Boolean))];

  const payload = {
    title: 'New arrival',
    body: `${productName} is now available — shop the latest collection.`,
    icon: absoluteUrl('/favicon.svg'),
    badge: absoluteUrl('/favicon.svg'),
    tag: `new-product-${productId}`,
    data: { url: absoluteUrl(productPath), type: 'new_product', productId: String(productId) }
  };

  const userSubs =
    userIds.length > 0
      ? await UserPushSubscription.find({ user: { $in: userIds }, isActive: true }).lean()
      : [];
  const guestSubs = await getActiveGuestSubscriptions();
  const allSubs = [...userSubs, ...guestSubs];

  const r = await sendPushToSubscriptions(allSubs, payload, { type: 'new_product' });
  return { sent: r.sent || 0, users: userIds.length, guests: guestSubs.length };
}

const ORDER_STATUS_LABELS = {
  pending: 'confirmed',
  processing: 'being processed',
  shipped: 'on the way',
  delivered: 'delivered',
  cancelled: 'cancelled'
};

async function notifyOrderStatus(userId, orderId, status, orderNumber = '') {
  if (!isPushConfigured() || !userId) return { skipped: true };
  const label = ORDER_STATUS_LABELS[status] || status;
  const ref = orderNumber ? ` #${orderNumber}` : '';
  const payload = {
    title: 'Order update',
    body: `Your order${ref} is ${label}.`,
    icon: absoluteUrl('/favicon.svg'),
    badge: absoluteUrl('/favicon.svg'),
    tag: `order-${orderId}-${status}`,
    data: {
      url: absoluteUrl(`/account/orders/${orderId}`),
      type: 'order',
      orderId: String(orderId),
      status
    }
  };
  return sendPushToUser(userId, payload, { type: 'order' });
}

async function notifySellerActivity(userId, activityType, details = {}) {
  if (!isPushConfigured() || !userId) return { skipped: true };
  const messages = {
    product_approved: 'Your product submission was approved and published.',
    new_review: 'You received a new product review.',
    product_views: 'Your product is getting more views.'
  };
  const body = details.message || messages[activityType] || 'You have new seller activity.';
  const payload = {
    title: 'Seller update',
    body,
    icon: absoluteUrl('/favicon.svg'),
    badge: absoluteUrl('/favicon.svg'),
    tag: `seller-${activityType}-${Date.now()}`,
    data: {
      url: absoluteUrl(details.url || '/admin/products'),
      type: 'seller',
      activityType
    }
  };
  return sendPushToUser(userId, payload, { type: 'seller', skipPreferenceCheck: true });
}

async function notifyDealInCategory(categoryId, title, body, url = '/shop') {
  if (!isPushConfigured() || !categoryId) return { skipped: true };

  const prefs = await UserNotificationPreferences.find({
    favoriteCategoryIds: categoryId,
    dealsEnabled: { $ne: false }
  })
    .select('user')
    .lean();

  const userIds = [...new Set(prefs.map((p) => String(p.user)).filter(Boolean))];
  const payload = {
    title: title || 'Flash deal',
    body: body || 'A promotion just started — don’t miss out!',
    icon: absoluteUrl('/favicon.svg'),
    badge: absoluteUrl('/favicon.svg'),
    tag: `deal-${categoryId}`,
    data: { url: absoluteUrl(url), type: 'deal', categoryId: String(categoryId) }
  };

  const userSubs =
    userIds.length > 0
      ? await UserPushSubscription.find({ user: { $in: userIds }, isActive: true }).lean()
      : [];
  const guestSubs = await getActiveGuestSubscriptions();
  const r = await sendPushToSubscriptions([...userSubs, ...guestSubs], payload, { type: 'deal' });
  return { sent: r.sent || 0, users: userIds.length, guests: guestSubs.length };
}

module.exports = {
  validateSubscriptionObject,
  saveSubscription,
  unsubscribeUser,
  unsubscribeByEndpoint,
  getSubscriptionStatus,
  getOrCreatePreferences,
  sendPushToUser,
  sendPushToGuests,
  sendPushToSubscriptions,
  clientIpFromRequest,
  notifyPriceChange,
  notifyNewProduct,
  notifyOrderStatus,
  notifySellerActivity,
  notifyDealInCategory,
  isPushConfigured,
  absoluteUrl,
  buildProductPath
};
