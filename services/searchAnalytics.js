const mongoose = require('mongoose');
const SearchAnalyticsEvent = require('../models/SearchAnalyticsEvent');

function clientIpFromReq(req) {
  const xff = req?.headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim();
  return (req?.ip && String(req.ip)) || '';
}

function sessionIdFromReq(req) {
  // Express-session is enabled in this project; still optional.
  const sid = req?.sessionID || req?.session?.id;
  return sid ? String(sid) : '';
}

async function logSearchQuery(req, { query, resultsCount, source }) {
  try {
    const q = String(query || '').trim().slice(0, 400);
    await SearchAnalyticsEvent.create({
      type: 'query',
      query: q,
      resultsCount: Math.max(0, Number(resultsCount) || 0),
      userId:
        req?.authUserId && mongoose.Types.ObjectId.isValid(req.authUserId)
          ? new mongoose.Types.ObjectId(req.authUserId)
          : null,
      sessionId: sessionIdFromReq(req),
      clientIp: clientIpFromReq(req),
      source: source ? String(source).slice(0, 80) : ''
    });
  } catch (e) {
    // analytics must never break search
    if (process.env.NODE_ENV === 'development') {
      console.warn('[searchAnalytics] logSearchQuery:', e.message);
    }
  }
}

async function logSearchClick(req, { query, productId, source }) {
  try {
    const q = String(query || '').trim().slice(0, 400);
    const pid =
      productId && mongoose.Types.ObjectId.isValid(productId)
        ? new mongoose.Types.ObjectId(productId)
        : null;
    await SearchAnalyticsEvent.create({
      type: 'click',
      query: q,
      productId: pid,
      userId:
        req?.authUserId && mongoose.Types.ObjectId.isValid(req.authUserId)
          ? new mongoose.Types.ObjectId(req.authUserId)
          : null,
      sessionId: sessionIdFromReq(req),
      clientIp: clientIpFromReq(req),
      source: source ? String(source).slice(0, 80) : ''
    });
  } catch (e) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[searchAnalytics] logSearchClick:', e.message);
    }
  }
}

async function getTrendingSearches({ days = 7, limit = 8 } = {}) {
  const d = Math.max(1, Math.min(90, Number(days) || 7));
  const lim = Math.max(1, Math.min(50, Number(limit) || 8));
  const since = new Date(Date.now() - d * 24 * 60 * 60 * 1000);

  const rows = await SearchAnalyticsEvent.aggregate([
    {
      $match: {
        type: 'query',
        createdAt: { $gte: since },
        query: { $type: 'string', $ne: '' }
      }
    },
    {
      $group: {
        _id: { $toLower: '$query' },
        count: { $sum: 1 },
        zeroCount: {
          $sum: {
            $cond: [{ $eq: ['$resultsCount', 0] }, 1, 0]
          }
        }
      }
    },
    { $sort: { count: -1 } },
    { $limit: lim }
  ]);

  return rows.map((r) => ({
    query: r._id,
    count: r.count,
    zeroCount: r.zeroCount
  }));
}

async function getZeroResultSearches({ days = 7, limit = 20 } = {}) {
  const d = Math.max(1, Math.min(365, Number(days) || 7));
  const lim = Math.max(1, Math.min(200, Number(limit) || 20));
  const since = new Date(Date.now() - d * 24 * 60 * 60 * 1000);

  const rows = await SearchAnalyticsEvent.aggregate([
    {
      $match: {
        type: 'query',
        createdAt: { $gte: since },
        resultsCount: 0,
        query: { $type: 'string', $ne: '' }
      }
    },
    {
      $group: {
        _id: { $toLower: '$query' },
        count: { $sum: 1 }
      }
    },
    { $sort: { count: -1 } },
    { $limit: lim }
  ]);

  return rows.map((r) => ({ query: r._id, count: r.count }));
}

module.exports = {
  logSearchQuery,
  logSearchClick,
  getTrendingSearches,
  getZeroResultSearches,
  clientIpFromReq
};

