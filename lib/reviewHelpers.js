const Order = require('../models/Order');
const Review = require('../models/Review');
const mongoose = require('mongoose');
const { uploadImageBuffer, ensureConfigured } = require('./cloudinary');
const { normalizeReviewTopic } = require('./reviewTopics');

const MAX_REVIEW_IMAGES = 5;

async function hasDeliveredPurchase(userId, productId) {
  if (!userId || !productId) return false;
  return Order.exists({
    user: userId,
    $or: [{ isDelivered: true }, { status: 'delivered' }],
    orderItems: { $elemMatch: { product: productId } }
  });
}

async function uploadReviewImages(files = []) {
  const list = Array.isArray(files) ? files.slice(0, MAX_REVIEW_IMAGES) : [];
  if (!list.length) return [];

  if (!ensureConfigured()) {
    const err = new Error(
      'Photo upload is not available right now. You can still submit your review without photos.'
    );
    err.code = 'UPLOAD_NOT_CONFIGURED';
    throw err;
  }

  const uploaded = [];
  for (const file of list) {
    if (!file?.buffer || !file.mimetype?.startsWith('image/')) continue;
    const img = await uploadImageBuffer(file.buffer, { folder: 'nova-shop/review-images' });
    uploaded.push({ url: img.url, publicId: img.public_id || '' });
  }
  return uploaded;
}

function productIdFromLine(line) {
  const p = line?.product;
  if (p == null) return null;
  if (typeof p === 'object') {
    if (p._id != null && mongoose.Types.ObjectId.isValid(String(p._id))) {
      return String(p._id);
    }
    return null;
  }
  const s = String(p).trim();
  return mongoose.Types.ObjectId.isValid(s) ? s : null;
}

/**
 * Per order line: can the customer leave a review?
 */
function productIdsFromOrder(order) {
  const lines = Array.isArray(order?.orderItems) ? order.orderItems : [];
  return [...new Set(lines.map(productIdFromLine).filter(Boolean))];
}

function orderOwnerId(order) {
  const u = order?.user;
  if (u == null) return null;
  if (typeof u === 'object' && u._id != null) return String(u._id);
  return String(u);
}

/**
 * Attach lightweight review summary to each delivered order in a list.
 * @returns {Promise<Map<string, { reviewCount: number, productCount: number, avgRating: number, ratings: number[] }>>}
 */
async function buildReviewSummariesForOrders(orders) {
  const map = new Map();
  if (!Array.isArray(orders) || !orders.length) return map;

  const targets = [];
  for (const order of orders) {
    if (order?.status !== 'delivered') continue;
    const userId = orderOwnerId(order);
    const productIds = productIdsFromOrder(order);
    if (!userId || !productIds.length) continue;
    targets.push({
      orderId: String(order._id),
      userId,
      productIds
    });
  }

  if (!targets.length) return map;

  const userObjectIds = [
    ...new Set(
      targets
        .map((t) => t.userId)
        .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
        .map((id) => String(id))
    )
  ].map((id) => new mongoose.Types.ObjectId(id));

  const reviews =
    userObjectIds.length > 0
      ? await Review.find({ user: { $in: userObjectIds } })
          .select('user product rating')
          .lean()
      : [];

  for (const target of targets) {
    const matched = reviews.filter(
      (r) =>
        String(r.user) === String(target.userId) &&
        target.productIds.includes(String(r.product))
    );
    if (!matched.length) continue;

    const ratings = matched.map((r) => Number(r.rating)).filter((n) => n >= 1 && n <= 5);
    const avgRating =
      ratings.length > 0 ? ratings.reduce((sum, n) => sum + n, 0) / ratings.length : null;

    map.set(target.orderId, {
      reviewCount: matched.length,
      productCount: target.productIds.length,
      avgRating,
      ratings
    });
  }

  return map;
}

/**
 * Full review meta for admin order popup (uses order owner, not caller).
 */
async function buildAdminOrderReviewDetails(order) {
  const userId = orderOwnerId(order);
  if (!userId || !order) {
    return { itemReviews: [], reviews: [] };
  }

  const productIds = productIdsFromOrder(order);
  const productObjectIds = productIds
    .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
    .map((id) => new mongoose.Types.ObjectId(String(id)));

  const userObjectId = mongoose.Types.ObjectId.isValid(String(userId))
    ? new mongoose.Types.ObjectId(String(userId))
    : null;

  const [itemReviews, reviews] = await Promise.all([
    buildOrderItemReviewMeta(userId, order),
    userObjectId && productObjectIds.length
      ? Review.find({ user: userObjectId, product: { $in: productObjectIds } })
          .select('_id product rating topic comment images createdAt')
          .sort({ createdAt: -1 })
          .lean()
      : Promise.resolve([])
  ]);

  const reviewDocsByProduct = new Map(reviews.map((r) => [String(r.product), r]));

  const enrichedItems = itemReviews.map((row) => {
    const doc = row.productId ? reviewDocsByProduct.get(String(row.productId)) : null;
    return {
      ...row,
      createdAt: doc?.createdAt || null
    };
  });

  return { itemReviews: enrichedItems, reviews };
}

async function buildOrderItemReviewMeta(userId, order) {
  if (!userId || !order || order.status !== 'delivered') return [];

  const lines = Array.isArray(order.orderItems) ? order.orderItems : [];
  const productIds = [...new Set(lines.map(productIdFromLine).filter(Boolean))];
  if (!productIds.length) return [];

  const reviews = await Review.find({
    user: mongoose.Types.ObjectId.isValid(String(userId))
      ? new mongoose.Types.ObjectId(String(userId))
      : userId,
    product: {
      $in: productIds
        .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
        .map((id) => new mongoose.Types.ObjectId(String(id)))
    }
  })
    .select('_id product rating topic comment images')
    .lean();

  const reviewByProduct = new Map(reviews.map((r) => [String(r.product), r]));

  return lines.map((line) => {
    const productId = productIdFromLine(line);
    const existing = productId ? reviewByProduct.get(productId) : null;
    const p = line.product;
    const productName =
      (typeof p === 'object' && p?.name) || line.name || 'Product';

    return {
      productId: productId || '',
      productName,
      canReview: Boolean(productId && !existing),
      hasReview: Boolean(existing),
      reviewId: existing?._id ? String(existing._id) : null,
      rating: existing?.rating != null ? Number(existing.rating) : null,
      topic: existing?.topic || '',
      comment: existing?.comment || '',
      images: Array.isArray(existing?.images) ? existing.images : []
    };
  });
}

function parseReviewRating(value) {
  const n = parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(n) || n < 1 || n > 5) return null;
  return n;
}

/**
 * Read review fields from JSON body or multipart (text fields + optional reviewJson blob).
 */
function extractReviewInput(req) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};

  let rating = parseReviewRating(body.rating);
  let comment = body.comment != null ? String(body.comment).slice(0, 2000) : '';
  let topic = normalizeReviewTopic(body.topic);

  const rawJson = body.reviewJson || body.review;
  if (rawJson) {
    try {
      const parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
      if (parsed && typeof parsed === 'object') {
        if (rating == null) rating = parseReviewRating(parsed.rating);
        if (!topic && parsed.topic) topic = normalizeReviewTopic(parsed.topic);
        if (!comment.trim() && parsed.comment != null) {
          comment = String(parsed.comment).slice(0, 2000);
        }
      }
    } catch {
      /* ignore malformed JSON */
    }
  }

  return { rating, comment, topic };
}

function reviewImageFiles(req) {
  const files = Array.isArray(req.files) ? req.files : [];
  return files.filter(
    (f) => f && (f.fieldname === 'images' || f.fieldname === 'image') && f.buffer
  );
}

module.exports = {
  MAX_REVIEW_IMAGES,
  hasDeliveredPurchase,
  uploadReviewImages,
  productIdFromLine,
  productIdsFromOrder,
  orderOwnerId,
  buildReviewSummariesForOrders,
  buildAdminOrderReviewDetails,
  buildOrderItemReviewMeta,
  parseReviewRating,
  extractReviewInput,
  reviewImageFiles
};
