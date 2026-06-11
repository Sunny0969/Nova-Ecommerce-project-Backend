const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const UserEvent = require('../models/UserEvent');
const ProductEmbedding = require('../models/ProductEmbedding');

function clamp(n, a, b) {
  return Math.min(b, Math.max(a, n));
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
}

function norm(a) {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * a[i];
  return Math.sqrt(s) || 1;
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  return dot(a, b) / (norm(a) * norm(b));
}

const { CARD_PRODUCT_SELECT } = require('../lib/productQueries');
const { shapeProductListItem } = require('../lib/productListShape');

async function loadProductsByIdsOrdered(ids) {
  const uniq = [...new Set(ids.map(String))].filter((x) => mongoose.Types.ObjectId.isValid(x));
  if (!uniq.length) return [];
  const rows = await Product.find({ _id: { $in: uniq }, isPublished: true })
    .select(CARD_PRODUCT_SELECT)
    .populate('category', 'name slug')
    .lean();
  const by = new Map(rows.map((r) => [String(r._id), r]));
  return ids
    .map((id) => by.get(String(id)))
    .filter(Boolean)
    .map(shapeProductListItem);
}

async function getUserPurchasedProductIds(userId, days = 365) {
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) return [];
  const since = new Date(Date.now() - clamp(days, 1, 3650) * 24 * 60 * 60 * 1000);
  const rows = await Order.find({
    user: userId,
    isPaid: true,
    createdAt: { $gte: since },
    status: { $nin: ['cancelled', 'rejected'] }
  })
    .select('orderItems.product')
    .lean();
  const ids = [];
  for (const o of rows) {
    for (const line of o.orderItems || []) {
      if (line?.product) ids.push(String(line.product));
    }
  }
  return [...new Set(ids)];
}

/**
 * A) Collaborative filtering: purchase co-occurrence from Orders.
 * Simple item-to-item: users who bought seed items also bought X.
 */
async function collaborativeRecommendations({ userId, limit = 10 }) {
  const seeds = await getUserPurchasedProductIds(userId, 365);
  if (!seeds.length) return [];

  const seedSet = new Set(seeds);

  // Find recent orders containing any seed product, then count co-occurring products.
  const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
  const rows = await Order.find({
    isPaid: true,
    createdAt: { $gte: since },
    status: { $nin: ['cancelled', 'rejected'] },
    'orderItems.product': { $in: seeds }
  })
    .select('user orderItems.product')
    .lean();

  const counts = new Map(); // productId -> cooccur count
  for (const o of rows) {
    const products = [...new Set((o.orderItems || []).map((l) => String(l.product)).filter(Boolean))];
    const hasSeed = products.some((id) => seedSet.has(id));
    if (!hasSeed) continue;
    for (const pid of products) {
      if (seedSet.has(pid)) continue;
      counts.set(pid, (counts.get(pid) || 0) + 1);
    }
  }

  const sorted = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, clamp(limit, 1, 30))
    .map(([pid]) => pid);

  return sorted;
}

/**
 * B) Content-based: use ProductEmbedding + recently viewed.
 * We compute the average embedding over recent views then score all embeddings.
 */
async function contentBasedRecommendations({ userId, sessionId, limit = 10 }) {
  const sid = sessionId ? String(sessionId).trim() : '';
  const filter = userId && mongoose.Types.ObjectId.isValid(userId) ? { userId } : sid ? { sessionId: sid } : null;
  if (!filter) return [];

  const recent = await UserEvent.find({ ...filter, eventType: 'view' })
    .sort({ createdAt: -1 })
    .limit(20)
    .select('productId')
    .lean();

  const viewedIds = [...new Set(recent.map((r) => String(r.productId)).filter(Boolean))];
  if (!viewedIds.length) return [];

  const viewedEmb = await ProductEmbedding.find({ productId: { $in: viewedIds } })
    .select('productId embedding')
    .lean();
  if (!viewedEmb.length) return [];

  const dims = viewedEmb[0].embedding.length;
  const avg = new Array(dims).fill(0);
  for (const r of viewedEmb) {
    const e = r.embedding;
    for (let i = 0; i < dims; i += 1) avg[i] += e[i];
  }
  for (let i = 0; i < dims; i += 1) avg[i] /= viewedEmb.length;

  const all = await ProductEmbedding.find({}).select('productId embedding').lean();
  const viewedSet = new Set(viewedIds);
  const scored = [];
  for (const r of all) {
    const pid = String(r.productId);
    if (viewedSet.has(pid)) continue;
    const s = cosineSimilarity(avg, r.embedding);
    scored.push({ pid, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, clamp(limit, 1, 30)).map((x) => x.pid);
}

/**
 * C) Trending: last 24h weighted events.
 * views*1 + cart*3 + purchase*10 + wishlist*3 + share*2
 */
async function trendingRecommendations({ limit = 10 }) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await UserEvent.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: { productId: '$productId', eventType: '$eventType' },
        c: { $sum: 1 }
      }
    },
    {
      $group: {
        _id: '$_id.productId',
        views: { $sum: { $cond: [{ $eq: ['$_id.eventType', 'view'] }, '$c', 0] } },
        cart: { $sum: { $cond: [{ $eq: ['$_id.eventType', 'add_to_cart'] }, '$c', 0] } },
        purchase: { $sum: { $cond: [{ $eq: ['$_id.eventType', 'purchase'] }, '$c', 0] } },
        wishlist: { $sum: { $cond: [{ $eq: ['$_id.eventType', 'wishlist'] }, '$c', 0] } },
        share: { $sum: { $cond: [{ $eq: ['$_id.eventType', 'share'] }, '$c', 0] } }
      }
    },
    {
      $addFields: {
        score: {
          $add: [
            '$views',
            { $multiply: ['$cart', 3] },
            { $multiply: ['$purchase', 10] },
            { $multiply: ['$wishlist', 3] },
            { $multiply: ['$share', 2] }
          ]
        }
      }
    },
    { $sort: { score: -1 } },
    { $limit: clamp(limit, 1, 30) }
  ]);
  return rows.map((r) => String(r._id));
}

/**
 * D) Personalized homepage mix.
 * 40% collaborative + 40% content + 20% trending (deduped).
 */
async function homepageRecommendations({ userId, sessionId, limit = 12 }) {
  const lim = clamp(limit, 4, 30);
  const [collab, content, trend] = await Promise.all([
    collaborativeRecommendations({ userId, limit: Math.ceil(lim * 0.6) }),
    contentBasedRecommendations({ userId, sessionId, limit: Math.ceil(lim * 0.6) }),
    trendingRecommendations({ limit: Math.ceil(lim * 0.6) })
  ]);

  const out = [];
  const seen = new Set();
  const push = (arr, max) => {
    for (const id of arr) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= max) return;
    }
  };

  // target buckets
  const collabTarget = Math.floor(lim * 0.4);
  const contentTarget = Math.floor(lim * 0.4);
  const trendTarget = lim - collabTarget - contentTarget;

  push(collab, collabTarget);
  push(content, collabTarget + contentTarget);
  push(trend, lim);

  // backfill if some bucket empty
  if (out.length < lim) push([...collab, ...content, ...trend], lim);

  return out.slice(0, lim);
}

/**
 * Similar products: purely embedding-based from a given product.
 */
async function similarProducts({ productId, limit = 10 }) {
  const pid = String(productId);
  if (!mongoose.Types.ObjectId.isValid(pid)) return [];
  const base = await ProductEmbedding.findOne({ productId: pid }).select('embedding').lean();
  if (!base?.embedding) return [];
  const all = await ProductEmbedding.find({ productId: { $ne: pid } })
    .select('productId embedding')
    .lean();
  const scored = all
    .map((r) => ({ pid: String(r.productId), s: cosineSimilarity(base.embedding, r.embedding) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, clamp(limit, 1, 30))
    .map((x) => x.pid);
  return scored;
}

/**
 * Frequently bought together: co-occurrence with a given product in paid orders.
 */
async function frequentlyBoughtTogether({ productId, limit = 10 }) {
  const pid = String(productId);
  if (!mongoose.Types.ObjectId.isValid(pid)) return [];
  const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const rows = await Order.find({
    isPaid: true,
    createdAt: { $gte: since },
    status: { $nin: ['cancelled', 'rejected'] },
    'orderItems.product': new mongoose.Types.ObjectId(pid)
  })
    .select('orderItems.product')
    .lean();

  const counts = new Map();
  for (const o of rows) {
    const products = [...new Set((o.orderItems || []).map((l) => String(l.product)).filter(Boolean))];
    for (const x of products) {
      if (x === pid) continue;
      counts.set(x, (counts.get(x) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, clamp(limit, 1, 30))
    .map(([id]) => id);
}

async function recentlyViewed({ userId, sessionId, limit = 12 }) {
  const sid = sessionId ? String(sessionId).trim() : '';
  const filter = userId && mongoose.Types.ObjectId.isValid(userId) ? { userId } : sid ? { sessionId: sid } : null;
  if (!filter) return [];
  const rows = await UserEvent.find({ ...filter, eventType: 'view' })
    .sort({ createdAt: -1 })
    .limit(50)
    .select('productId')
    .lean();
  const ids = [];
  const seen = new Set();
  for (const r of rows) {
    const id = String(r.productId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= clamp(limit, 1, 30)) break;
  }
  return ids;
}

module.exports = {
  loadProductsByIdsOrdered,
  collaborativeRecommendations,
  contentBasedRecommendations,
  trendingRecommendations,
  homepageRecommendations,
  similarProducts,
  frequentlyBoughtTogether,
  recentlyViewed
};

