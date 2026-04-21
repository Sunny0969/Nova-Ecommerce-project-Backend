/**
 * Admin dashboard metrics — `requireAdmin` on mount in server.js.
 */

const express = require('express');
const Order = require('../../models/Order');
const Product = require('../../models/Product');
const User = require('../../models/User');
const { ORDER_POPULATE } = require('../../services/orderFromPaymentIntent');

const router = express.Router();

function ok(res, payload) {
  res.json({ success: true, ...payload });
}

function fail(res, status, message) {
  res.status(status).json({ success: false, message });
}

/** @param {number | null | undefined} current @param {number | null | undefined} previous */
function percentChange(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous);
  if (p == null || Number.isNaN(p)) return null;
  if (p === 0) return c > 0 ? 100 : 0;
  return Number((((c - p) / p) * 100).toFixed(2));
}

function utcDayStart(d) {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0)
  );
}

function utcDayEnd(d) {
  const x = utcDayStart(d);
  x.setUTCDate(x.getUTCDate() + 1);
  return new Date(x.getTime() - 1);
}

/** Start of calendar month UTC */
function utcMonthStart(year, month0) {
  return new Date(Date.UTC(year, month0, 1, 0, 0, 0, 0));
}

/** @returns {{ start: Date, end: Date, prevStart: Date, prevEnd: Date }} MTD vs same-length window in previous month */
function mtdAlignedRanges(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const day = now.getUTCDate();
  const startThis = utcMonthStart(y, m);
  const endThis = now;

  const prevMonth = m === 0 ? 11 : m - 1;
  const prevYear = m === 0 ? y - 1 : y;
  const prevStart = utcMonthStart(prevYear, prevMonth);
  const dimPrev = new Date(Date.UTC(prevYear, prevMonth + 1, 0)).getUTCDate();
  const alignDay = Math.min(day, dimPrev);
  const prevEnd = new Date(
    Date.UTC(prevYear, prevMonth, alignDay, 23, 59, 59, 999)
  );

  return { startThis, endThis, prevStart, prevEnd };
}

function deliveredRevenueDateExpr() {
  return {
    $ifNull: ['$deliveredAt', '$updatedAt']
  };
}

function fillDailyRevenuePoints(fromUtcDay, toUtcDay, revenueByDay) {
  const points = [];
  const cur = utcDayStart(new Date(fromUtcDay));
  const end = utcDayStart(new Date(toUtcDay));
  while (cur <= end) {
    const key = cur.toISOString().slice(0, 10);
    points.push({
      key,
      label: key,
      revenue: revenueByDay[key] || 0
    });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return points;
}

function fillMonthlyRevenuePoints(monthKeys, revenueByMonth) {
  return monthKeys.map((key) => ({
    key,
    label: key,
    revenue: revenueByMonth[key] || 0
  }));
}

/**
 * GET /api/admin/dashboard/stats
 */
router.get('/stats', async (req, res) => {
  try {
    const now = new Date();
    const { startThis, endThis, prevStart, prevEnd } = mtdAlignedRanges(now);

    const startThisMonth = utcMonthStart(now.getUTCFullYear(), now.getUTCMonth());
    const endLastMonth = new Date(startThisMonth.getTime() - 1);

    const todayStart = utcDayStart(now);
    const todayEnd = utcDayEnd(now);
    const yestStart = new Date(todayStart);
    yestStart.setUTCDate(yestStart.getUTCDate() - 1);
    const yestEnd = new Date(todayStart.getTime() - 1);

    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);

    const [
      revThisMtd,
      revPrevAligned,
      ordersToday,
      ordersYesterday,
      totalOrdersAllTime,
      ordersEndLastMonth,
      ordersMtd,
      ordersMtdPrev,
      totalProducts,
      productsEndLastMonth,
      lowStock,
      totalCustomers,
      customersEndLastMonth,
      newCustomersThisMonth,
      newCustomersPrevMonthAligned,
      recentOrders,
      topAgg,
      lowStockList
    ] = await Promise.all([
      Order.aggregate([
        { $match: { status: 'delivered' } },
        {
          $addFields: { _revDate: deliveredRevenueDateExpr() }
        },
        {
          $match: {
            _revDate: { $gte: startThis, $lte: endThis }
          }
        },
        { $group: { _id: null, total: { $sum: '$totalPrice' } } }
      ]),
      Order.aggregate([
        { $match: { status: 'delivered' } },
        { $addFields: { _revDate: deliveredRevenueDateExpr() } },
        {
          $match: {
            _revDate: { $gte: prevStart, $lte: prevEnd }
          }
        },
        { $group: { _id: null, total: { $sum: '$totalPrice' } } }
      ]),
      Order.countDocuments({ createdAt: { $gte: todayStart, $lte: todayEnd } }),
      Order.countDocuments({ createdAt: { $gte: yestStart, $lte: yestEnd } }),
      Order.countDocuments({}),
      Order.countDocuments({ createdAt: { $lte: endLastMonth } }),
      Order.countDocuments({
        createdAt: { $gte: startThis, $lte: endThis }
      }),
      Order.countDocuments({
        createdAt: { $gte: prevStart, $lte: prevEnd }
      }),
      Product.countDocuments({}),
      Product.countDocuments({ createdAt: { $lte: endLastMonth } }),
      Product.countDocuments({ stock: { $lt: 10 } }),
      User.countDocuments({ role: 'customer' }),
      User.countDocuments({
        role: 'customer',
        createdAt: { $lte: endLastMonth }
      }),
      User.countDocuments({
        role: 'customer',
        createdAt: { $gte: startThisMonth, $lte: endThis }
      }),
      User.countDocuments({
        role: 'customer',
        createdAt: { $gte: prevStart, $lte: prevEnd }
      }),
      Order.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .populate(ORDER_POPULATE)
        .lean(),
      Order.aggregate([
        {
          $match: {
            createdAt: { $gte: thirtyDaysAgo },
            status: { $ne: 'cancelled' }
          }
        },
        { $unwind: '$orderItems' },
        {
          $group: {
            _id: '$orderItems.product',
            revenue: {
              $sum: {
                $multiply: ['$orderItems.price', '$orderItems.quantity']
              }
            },
            units: { $sum: '$orderItems.quantity' }
          }
        },
        { $sort: { revenue: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: 'products',
            localField: '_id',
            foreignField: '_id',
            as: 'productDoc'
          }
        },
        { $unwind: { path: '$productDoc', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            product: {
              _id: '$productDoc._id',
              name: '$productDoc.name',
              slug: '$productDoc.slug',
              images: '$productDoc.images',
              price: '$productDoc.price'
            },
            revenue: 1,
            units: 1
          }
        }
      ]),
      Product.find({ stock: { $lt: 10 } })
        .select('name slug stock images price')
        .sort({ stock: 1 })
        .limit(20)
        .lean()
    ]);

    const totalRevenue = revThisMtd[0]?.total || 0;
    const totalRevenuePrev = revPrevAligned[0]?.total || 0;

    return ok(res, {
      data: {
        totalRevenue: {
          value: totalRevenue,
          previous: totalRevenuePrev,
          percentChange: percentChange(totalRevenue, totalRevenuePrev),
          note: 'Delivered orders; MTD vs same calendar span last month'
        },
        ordersMtd: {
          value: ordersMtd,
          previous: ordersMtdPrev,
          percentChange: percentChange(ordersMtd, ordersMtdPrev)
        },
        totalOrders: {
          value: totalOrdersAllTime,
          previous: ordersEndLastMonth,
          percentChange: percentChange(totalOrdersAllTime, ordersEndLastMonth)
        },
        newOrdersToday: {
          value: ordersToday,
          previous: ordersYesterday,
          percentChange: percentChange(ordersToday, ordersYesterday)
        },
        totalProducts: {
          value: totalProducts,
          previous: productsEndLastMonth,
          percentChange: percentChange(totalProducts, productsEndLastMonth)
        },
        lowStockProducts: {
          value: lowStock,
          previous: null,
          percentChange: null
        },
        totalCustomers: {
          value: totalCustomers,
          previous: customersEndLastMonth,
          percentChange: percentChange(totalCustomers, customersEndLastMonth)
        },
        newCustomersThisMonth: {
          value: newCustomersThisMonth,
          previous: newCustomersPrevMonthAligned,
          percentChange: percentChange(
            newCustomersThisMonth,
            newCustomersPrevMonthAligned
          )
        },
        recentOrders,
        topProducts: topAgg,
        lowStockList
      }
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    return fail(res, 500, error.message || 'Failed to load dashboard stats');
  }
});

/**
 * GET /api/admin/dashboard/revenue-chart?period=7d|30d|6m|1y
 */
router.get('/revenue-chart', async (req, res) => {
  try {
    const period = String(req.query.period || '30d').toLowerCase();
    const allowed = ['7d', '30d', '6m', '1y'];
    if (!allowed.includes(period)) {
      return fail(
        res,
        400,
        `Invalid period. Use one of: ${allowed.join(', ')}`
      );
    }

    const now = new Date();

    if (period === '7d' || period === '30d') {
      const days = period === '7d' ? 7 : 30;
      const toDay = utcDayStart(now);
      const fromDay = new Date(toDay);
      fromDay.setUTCDate(fromDay.getUTCDate() - (days - 1));

      const rows = await Order.aggregate([
        { $match: { status: 'delivered' } },
        { $addFields: { _revDate: deliveredRevenueDateExpr() } },
        {
          $match: {
            _revDate: { $gte: fromDay, $lte: now }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$_revDate',
                timezone: 'UTC'
              }
            },
            revenue: { $sum: '$totalPrice' }
          }
        }
      ]);

      const revenueByDay = Object.fromEntries(
        rows.map((r) => [r._id, r.revenue])
      );
      const points = fillDailyRevenuePoints(fromDay, toDay, revenueByDay);

      return ok(res, {
        data: {
          period,
          granularity: 'day',
          points
        }
      });
    }

    const months = period === '6m' ? 6 : 12;
    const monthKeys = [];
    for (let i = months - 1; i >= 0; i--) {
      const ref = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)
      );
      const y = ref.getUTCFullYear();
      const m = ref.getUTCMonth();
      monthKeys.push(`${y}-${String(m + 1).padStart(2, '0')}`);
    }

    const rangeStart = utcMonthStart(
      now.getUTCFullYear(),
      now.getUTCMonth() - (months - 1)
    );

    const rows = await Order.aggregate([
      { $match: { status: 'delivered' } },
      { $addFields: { _revDate: deliveredRevenueDateExpr() } },
      {
        $match: {
          _revDate: { $gte: rangeStart, $lte: now }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m',
              date: '$_revDate',
              timezone: 'UTC'
            }
          },
          revenue: { $sum: '$totalPrice' }
        }
      }
    ]);

    const revenueByMonth = Object.fromEntries(
      rows.map((r) => [r._id, r.revenue])
    );
    const points = fillMonthlyRevenuePoints(monthKeys, revenueByMonth);

    return ok(res, {
      data: {
        period,
        granularity: 'month',
        points
      }
    });
  } catch (error) {
    console.error('Revenue chart error:', error);
    return fail(res, 500, error.message || 'Failed to load revenue chart');
  }
});

/**
 * GET /api/admin/dashboard/orders-chart — order counts per day, last 30 days
 */
router.get('/orders-chart', async (req, res) => {
  try {
    const now = new Date();
    const toDay = utcDayStart(now);
    const fromDay = new Date(toDay);
    fromDay.setUTCDate(fromDay.getUTCDate() - 29);

    const rows = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: fromDay, $lte: now }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$createdAt',
              timezone: 'UTC'
            }
          },
          count: { $sum: 1 }
        }
      }
    ]);

    const countByDay = Object.fromEntries(
      rows.map((r) => [r._id, r.count])
    );
    const points = [];
    const cur = new Date(fromDay);
    const end = new Date(toDay);
    while (cur <= end) {
      const key = cur.toISOString().slice(0, 10);
      points.push({
        key,
        label: key,
        count: countByDay[key] || 0
      });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    return ok(res, {
      data: {
        granularity: 'day',
        days: 30,
        points
      }
    });
  } catch (error) {
    console.error('Orders chart error:', error);
    return fail(res, 500, error.message || 'Failed to load orders chart');
  }
});

module.exports = router;
