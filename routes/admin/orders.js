const express = require('express');
const mongoose = require('mongoose');
const Order = require('../../models/Order');
const User = require('../../models/User');
const { sendOrderShippedEmail } = require('../../lib/email');
const { ORDER_POPULATE } = require('../../services/orderFromPaymentIntent');
const { creditCashbackForOrder } = require('../../services/walletService');
const {
  hydratePaymentProof,
  persistHydratedPaymentProof
} = require('../../utils/paymentProof');

const router = express.Router();

const ORDER_STATUSES = [
  'pending',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'flagged',
  'rejected'
];

function ok(res, status, payload) {
  res.status(status).json({ success: true, ...payload });
}

function fail(res, status, message, errors) {
  const body = { success: false, message };
  if (errors && Object.keys(errors).length) body.errors = errors;
  res.status(status).json(body);
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseDateEnd(d) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  const end = new Date(x);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

/**
 * GET /api/admin/orders/stats — counts by status (register before /:id)
 */
router.get('/stats', async (req, res) => {
  try {
    const rows = await Order.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const byStatus = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0]));
    let total = 0;
    for (const row of rows) {
      if (row._id && byStatus[row._id] !== undefined) {
        byStatus[row._id] = row.count;
        total += row.count;
      }
    }
    return ok(res, 200, {
      data: { byStatus, total }
    });
  } catch (error) {
    console.error('Admin order stats error:', error);
    return fail(res, 500, error.message || 'Failed to load stats');
  }
});

/**
 * GET /api/admin/orders — list with filters
 */
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const clauses = [];

    const status = req.query.status;
    if (status != null && String(status).trim() !== '') {
      const s = String(status).trim();
      if (!ORDER_STATUSES.includes(s)) {
        return fail(res, 400, `Invalid status. Allowed: ${ORDER_STATUSES.join(', ')}`);
      }
      clauses.push({ status: s });
    }

    const from = req.query.from || req.query.dateFrom;
    const to = req.query.to || req.query.dateTo;
    if (from || to) {
      const range = {};
      if (from) {
        const d = new Date(from);
        if (Number.isNaN(d.getTime())) {
          return fail(res, 400, 'Invalid from / dateFrom');
        }
        range.$gte = d;
      }
      if (to) {
        const end = parseDateEnd(to);
        if (!end) {
          return fail(res, 400, 'Invalid to / dateTo');
        }
        range.$lte = end;
      }
      clauses.push({ createdAt: range });
    }

    const searchRaw = req.query.search || req.query.q;
    const search =
      searchRaw != null && String(searchRaw).trim() !== ''
        ? String(searchRaw).trim()
        : '';

    if (search) {
      const or = [];
      if (isValidObjectId(search) && search.length === 24) {
        or.push({ _id: new mongoose.Types.ObjectId(search) });
      }
      or.push({
        trackingNumber: { $regex: escapeRegex(search), $options: 'i' }
      });
      or.push({
        'orderItems.name': { $regex: escapeRegex(search), $options: 'i' }
      });
      or.push({
        'paymentProof.transactionId': { $regex: escapeRegex(search), $options: 'i' }
      });

      const matchingUsers = await User.find({
        $or: [
          { email: { $regex: escapeRegex(search), $options: 'i' } },
          { name: { $regex: escapeRegex(search), $options: 'i' } }
        ]
      })
        .select('_id')
        .lean();
      if (matchingUsers.length) {
        or.push({ user: { $in: matchingUsers.map((u) => u._id) } });
      }

      clauses.push({ $or: or });
    }

    const filter = clauses.length === 0 ? {} : clauses.length === 1 ? clauses[0] : { $and: clauses };

    const [orders, totalCount] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({ path: 'user', select: 'name email' })
        .populate({
          path: 'orderItems.product',
          select: 'name slug images'
        })
        .populate({ path: 'coupon', select: 'code discountType' })
        .lean(),
      Order.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(totalCount / limit) || 0;

    return ok(res, 200, {
      data: {
        orders,
        totalCount,
        totalPages,
        currentPage: page
      }
    });
  } catch (error) {
    console.error('Admin list orders error:', error);
    return fail(res, 500, error.message || 'Failed to list orders');
  }
});

/**
 * GET /api/admin/orders/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return fail(res, 400, 'Invalid order id');
    }

    let order = await Order.findById(id).populate(ORDER_POPULATE);

    if (!order) {
      return fail(res, 404, 'Order not found');
    }

    hydratePaymentProof(order);
    try {
      await persistHydratedPaymentProof(order);
    } catch (persistErr) {
      console.warn('Payment proof hydrate save skipped:', persistErr.message);
    }

    return ok(res, 200, { data: { order } });
  } catch (error) {
    if (error.name === 'CastError') {
      return fail(res, 400, 'Invalid order id');
    }
    console.error('Admin get order error:', error);
    return fail(res, 500, error.message || 'Failed to fetch order');
  }
});

/**
 * PUT /api/admin/orders/:id/status
 */
router.put('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return fail(res, 400, 'Invalid order id');
    }

    const { status } = req.body;
    if (status == null || typeof status !== 'string') {
      return fail(res, 400, 'status is required');
    }
    const nextStatus = status.trim();
    if (!ORDER_STATUSES.includes(nextStatus)) {
      return fail(res, 400, `Invalid status. Allowed: ${ORDER_STATUSES.join(', ')}`);
    }

    const order = await Order.findById(id);
    if (!order) {
      return fail(res, 404, 'Order not found');
    }

    order.status = nextStatus;
    if (nextStatus === 'delivered') {
      order.isDelivered = true;
      order.deliveredAt = order.deliveredAt || new Date();
      await order.save();
      try {
        await creditCashbackForOrder(order);
      } catch (cashbackErr) {
        console.error('Wallet cashback error:', cashbackErr);
      }
    } else {
      await order.save();
    }

    const populated = await Order.findById(order._id).populate(ORDER_POPULATE);
    return ok(res, 200, {
      message: 'Order status updated',
      data: { order: populated }
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const errors = Object.fromEntries(
        Object.values(error.errors || {}).map((e) => [e.path || 'field', e.message])
      );
      return fail(res, 400, 'Invalid data', errors);
    }
    console.error('Admin update status error:', error);
    return fail(res, 500, error.message || 'Failed to update status');
  }
});

/**
 * PUT /api/admin/orders/:id/payment-proof — admin sets transaction ID / notes
 */
router.put('/:id/payment-proof', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return fail(res, 400, 'Invalid order id');
    }

    const order = await Order.findById(id);
    if (!order) {
      return fail(res, 404, 'Order not found');
    }

    const txnId =
      req.body.transactionId != null ? String(req.body.transactionId).trim().slice(0, 120) : '';

    if (!txnId) {
      return fail(res, 400, 'transactionId is required');
    }

    order.paymentProof = {
      transactionId: txnId,
      imageUrl: order.paymentProof?.imageUrl || '',
      imagePublicId: order.paymentProof?.imagePublicId || '',
      submittedAt: new Date()
    };

    const baseNote = order.notes || '';
    if (!/Transaction\s*ID\s*:/i.test(baseNote)) {
      order.notes = `${baseNote} Transaction ID: ${txnId}.`.trim();
    }

    await order.save();

    const populated = await Order.findById(order._id).populate(ORDER_POPULATE);
    return ok(res, 200, {
      message: 'Payment proof updated',
      data: { order: populated }
    });
  } catch (error) {
    console.error('Admin payment proof error:', error);
    return fail(res, 500, error.message || 'Failed to update payment proof');
  }
});

/**
 * PUT /api/admin/orders/:id/paid — mark COD / bank transfer received
 */
router.put('/:id/paid', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return fail(res, 400, 'Invalid order id');
    }

    const order = await Order.findById(id);
    if (!order) {
      return fail(res, 404, 'Order not found');
    }

    const paid = req.body.isPaid !== false;
    order.isPaid = paid;
    order.paidAt = paid ? order.paidAt || new Date() : null;
    if (paid && order.status === 'pending') {
      order.status = 'processing';
    }

    await order.save();

    const populated = await Order.findById(order._id).populate(ORDER_POPULATE);
    return ok(res, 200, {
      message: paid ? 'Order marked as paid' : 'Order marked as unpaid',
      data: { order: populated }
    });
  } catch (error) {
    console.error('Admin mark paid error:', error);
    return fail(res, 500, error.message || 'Failed to update payment');
  }
});

/**
 * PUT /api/admin/orders/:id/tracking
 */
router.put('/:id/tracking', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return fail(res, 400, 'Invalid order id');
    }

    const { trackingNumber } = req.body;
    if (trackingNumber == null || typeof trackingNumber !== 'string') {
      return fail(res, 400, 'trackingNumber is required');
    }
    const tn = trackingNumber.trim();
    if (!tn) {
      return fail(res, 400, 'trackingNumber cannot be empty');
    }
    if (tn.length > 200) {
      return fail(res, 400, 'trackingNumber is too long');
    }

    const order = await Order.findById(id);
    if (!order) {
      return fail(res, 404, 'Order not found');
    }

    order.trackingNumber = tn;
    await order.save();

    const user = await User.findById(order.user).select('name email').lean();
    if (user?.email) {
      try {
        await sendOrderShippedEmail(user, order);
      } catch (mailErr) {
        console.error('Shipped email failed:', mailErr);
      }
    }

    const populated = await Order.findById(order._id).populate(ORDER_POPULATE);
    return ok(res, 200, {
      message: 'Tracking saved and customer notified',
      data: { order: populated }
    });
  } catch (error) {
    console.error('Admin tracking error:', error);
    return fail(res, 500, error.message || 'Failed to save tracking');
  }
});

module.exports = router;
