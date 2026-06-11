const bizSdk = require('facebook-nodejs-business-sdk');
const { publicSiteUrl } = require('../lib/publicSiteUrl');

const { CustomData, EventRequest, UserData, ServerEvent, FacebookAdsApi } = bizSdk;

const PIXEL_ID = String(process.env.META_PIXEL_ID || '1519068336295914').trim();
const ACCESS_TOKEN = String(process.env.META_CAPI_ACCESS_TOKEN || '').trim();
const TEST_EVENT_CODE = String(process.env.META_TEST_EVENT_CODE || '').trim();

const ALLOWED_EVENTS = new Set([
  'ViewContent',
  'AddToCart',
  'InitiateCheckout',
  'AddPaymentInfo',
  'Purchase',
  'CompleteRegistration',
  'Search',
  'AddToWishlist',
  'Contact',
  'Lead'
]);

const scheduledPurchases = new Set();

function isConfigured() {
  return Boolean(ACCESS_TOKEN && PIXEL_ID);
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function frontendBase() {
  return publicSiteUrl();
}

function clientIpFromReq(req) {
  if (!req) return '';
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return (req.ip && String(req.ip)) || '';
}

function normalizeEmail(email) {
  const v = String(email || '').trim().toLowerCase();
  return v && v.includes('@') ? v : '';
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits : '';
}

function hasCustomerSignal(ctx) {
  return Boolean(
    normalizeEmail(ctx.email) ||
      normalizePhone(ctx.phone) ||
      ctx.firstName ||
      ctx.lastName ||
      ctx.city ||
      ctx.state ||
      ctx.zipCode ||
      ctx.country ||
      ctx.externalId ||
      ctx.clientIp ||
      ctx.userAgent ||
      ctx.fbc ||
      ctx.fbp
  );
}

/**
 * Build UserData per Meta CAPI spec (SDK SHA256-hashes em/ph automatically).
 */
function buildUserData(ctx = {}) {
  const userData = new UserData();

  const email = normalizeEmail(ctx.email);
  const phone = normalizePhone(ctx.phone);

  if (email) userData.setEmail(email);
  if (phone) userData.setPhone(phone);
  if (ctx.firstName) userData.setFirstName(String(ctx.firstName).trim());
  if (ctx.lastName) userData.setLastName(String(ctx.lastName).trim());
  if (ctx.city) userData.setCity(String(ctx.city).trim());
  if (ctx.state) userData.setState(String(ctx.state).trim());
  if (ctx.zipCode) userData.setZipCode(String(ctx.zipCode).trim());
  if (ctx.country) userData.setCountry(String(ctx.country).trim());
  if (ctx.externalId) userData.setExternalId(String(ctx.externalId).trim());
  if (ctx.fbc) userData.setFbc(String(ctx.fbc).trim());
  if (ctx.fbp) userData.setFbp(String(ctx.fbp).trim());

  if (ctx.clientIp) userData.setClientIpAddress(String(ctx.clientIp).trim());
  if (ctx.userAgent) userData.setClientUserAgent(String(ctx.userAgent).trim());

  return userData;
}

function buildCustomData(custom = {}) {
  const customData = new CustomData();

  const currency = custom.currency;
  if (currency) customData.setCurrency(String(currency).toUpperCase());

  const value = custom.value;
  if (value != null && Number.isFinite(Number(value))) {
    customData.setValue(round2(value));
  }

  const contentIds = custom.contentIds || custom.content_ids;
  if (Array.isArray(contentIds) && contentIds.length) {
    customData.setContentIds(contentIds.map(String));
  }

  const contentType = custom.contentType || custom.content_type;
  if (contentType) customData.setContentType(String(contentType));

  const contentName = custom.contentName || custom.content_name;
  if (contentName) customData.setContentName(String(contentName));

  const numItems = custom.numItems ?? custom.num_items;
  if (numItems != null && Number.isFinite(Number(numItems))) {
    customData.setNumItems(Number(numItems));
  }

  if (custom.searchString) customData.setSearchString(String(custom.searchString).slice(0, 200));

  return customData;
}

/**
 * Send a website event to Meta Conversions API (Payload Helper compliant).
 * Required: event_name, event_time, action_source, event_source_url, client_user_agent
 * Recommended: event_id (dedup with browser pixel)
 */
async function sendWebsiteEvent({
  eventName,
  eventId,
  eventSourceUrl,
  eventTime,
  userCtx = {},
  customData = {}
}) {
  if (!isConfigured()) {
    return { skipped: true, reason: 'not_configured' };
  }

  const name = String(eventName || '').trim();
  if (!ALLOWED_EVENTS.has(name)) {
    return { skipped: true, reason: 'invalid_event_name' };
  }

  const sourceUrl = String(eventSourceUrl || `${frontendBase()}/`).trim();
  const userAgent = String(userCtx.userAgent || '').trim();
  const clientIp = String(userCtx.clientIp || '').trim();

  if (!sourceUrl) {
    return { skipped: true, reason: 'missing_event_source_url' };
  }
  if (!userAgent) {
    return { skipped: true, reason: 'missing_client_user_agent' };
  }
  if (!hasCustomerSignal(userCtx)) {
    return { skipped: true, reason: 'missing_customer_parameters' };
  }

  try {
    FacebookAdsApi.init(ACCESS_TOKEN);

    const serverEvent = new ServerEvent()
      .setEventName(name)
      .setEventTime(eventTime || Math.floor(Date.now() / 1000))
      .setActionSource('website')
      .setEventSourceUrl(sourceUrl)
      .setUserData(buildUserData(userCtx))
      .setCustomData(buildCustomData(customData));

    if (eventId) {
      serverEvent.setEventId(String(eventId).slice(0, 120));
    }

    const eventRequest = new EventRequest(ACCESS_TOKEN, PIXEL_ID).setEvents([serverEvent]);

    if (TEST_EVENT_CODE) {
      eventRequest.setTestEventCode(TEST_EVENT_CODE);
    }

    const response = await eventRequest.execute();
    return { ok: true, response };
  } catch (error) {
    console.error(`[meta-capi] ${name} error:`, error?.message || error);
    return { ok: false, error };
  }
}

function purchaseValue(order) {
  const total = Number(order.totalPrice) || 0;
  const wallet = Number(order.walletAmountUsed) || 0;
  return round2(total + wallet);
}

function orderContentIds(order) {
  return (order.orderItems || [])
    .map((line) => {
      const ref = line.product;
      if (ref && typeof ref === 'object' && ref._id) return String(ref._id);
      if (ref) return String(ref);
      return '';
    })
    .filter(Boolean);
}

function contextFromOrder(order, req) {
  const shipping = order.shippingAddress || {};
  return {
    clientIp: clientIpFromReq(req) || String(order.clientIp || '').trim(),
    userAgent: req?.headers?.['user-agent'] || '',
    email: shipping.email || order.paymentResult?.email_address || '',
    phone: shipping.phone || '',
    firstName: shipping.firstName || '',
    lastName: shipping.lastName || '',
    city: shipping.city || '',
    state: shipping.state || '',
    zipCode: shipping.zipCode || '',
    country: shipping.country || 'Pakistan'
  };
}

async function trackServerPurchase(order, ctx = {}) {
  if (!order?._id) {
    return { skipped: true, reason: 'no_order' };
  }

  const orderId = String(order._id);
  const numItems = (order.orderItems || []).reduce(
    (n, line) => n + (Number(line.quantity) || 0),
    0
  );

  const result = await sendWebsiteEvent({
    eventName: 'Purchase',
    eventId: orderId,
    eventSourceUrl: `${frontendBase()}/order-confirmation/${orderId}`,
    userCtx: ctx,
    customData: {
      currency: 'PKR',
      value: purchaseValue(order),
      contentIds: orderContentIds(order),
      contentType: 'product',
      numItems
    }
  });

  if (result.ok) {
    console.log('[meta-capi] Purchase sent for order', orderId.slice(-8).toUpperCase());
  }

  return result;
}

function scheduleMetaPurchaseFromResult(result, req) {
  if (!isConfigured()) return;
  if (!result || result.duplicate || !result.populated?._id) return;
  if (result.populated.status === 'flagged') return;

  const orderId = String(result.populated._id);
  if (scheduledPurchases.has(orderId)) return;
  scheduledPurchases.add(orderId);

  const order = result.populated;
  const shipping = order.shippingAddress || {};
  const ctx = contextFromOrder(order, req);
  if (!ctx.email) {
    ctx.email = result.emailNotify?.addr?.email || result.emailNotify?.user?.email || '';
  }
  if (!ctx.phone) {
    ctx.phone = result.emailNotify?.addr?.phone || '';
  }

  setImmediate(() => {
    void trackServerPurchase(order, ctx);
  });
}

function contextFromReq(req, body = {}) {
  return {
    clientIp: clientIpFromReq(req),
    userAgent: req?.headers?.['user-agent'] || '',
    email: body.email || '',
    phone: body.phone || '',
    firstName: body.firstName || '',
    lastName: body.lastName || '',
    city: body.city || '',
    state: body.state || '',
    zipCode: body.zipCode || '',
    country: body.country || '',
    fbc: body.fbc || req?.cookies?._fbc || '',
    fbp: body.fbp || req?.cookies?._fbp || ''
  };
}

module.exports = {
  isConfigured,
  ALLOWED_EVENTS,
  sendWebsiteEvent,
  trackServerPurchase,
  scheduleMetaPurchaseFromResult,
  contextFromReq,
  contextFromOrder
};
