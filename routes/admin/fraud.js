const express = require('express');
const mongoose = require('mongoose');
const FraudLog = require('../../models/FraudLog');
const Blocklist = require('../../models/Blocklist');
const Order = require('../../models/Order');
const User = require('../../models/User');
const Product = require('../../models/Product');
const { getStripe } = require('../../lib/stripeClient');
const {
  sendOrderConfirmationEmail,
  sendMail
} = require('../../lib/email');
const { ORDER_POPULATE } = require('../../services/orderFromPaymentIntent');

const router = express.Router();

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

async function incrementStockRollback(productId, qty) {
  await Product.findOneAndUpdate(
    { _id: productId },
    [{ $set: { stock: { $add: ['$stock', qty] } } }]
  );
}

/**
 * GET /api/admin/fraud/logs — flagged queue (default) or all logs
 */
router.get('/logs', async (req, res) => {
  try {
    const scope = String(req.query.scope || 'open');
    const filter =
      scope === 'all'
        ? {}
        : {
            action: 'flagged',
            $or: [
              { reviewAction: { $exists: false } },
              { reviewAction: null },
              { reviewAction: '' }
            ]
          };

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const skip = (page - 1) * limit;

    const [logs, totalCount] = await Promise.all([
      FraudLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: 'orderId',
          populate: [
            { path: 'user', select: 'name email' },
            {
              path: 'orderItems.product',
              select: 'name slug price images'
            }
          ]
        })
        .populate('userId', 'name email')
        .lean(),
      FraudLog.countDocuments(filter)
    ]);

    return ok(res, 200, {
      data: {
        logs,
        totalCount,
        totalPages: Math.ceil(totalCount / limit) || 0,
        currentPage: page
      }
    });
  } catch (error) {
    console.error('Admin fraud logs error:', error);
    return fail(res, 500, error.message || 'Failed to load fraud logs');
  }
});

/**
 * GET /api/admin/fraud/stats
 */
router.get('/stats', async (req, res) => {
  try {
    const totalChecks = await FraudLog.countDocuments();
    const flaggedOpen = await FraudLog.countDocuments({
      action: 'flagged',
      $or: [
        { reviewAction: { $exists: false } },
        { reviewAction: null },
        { reviewAction: '' }
      ]
    });
    const autoRejected = await FraudLog.countDocuments({ action: 'rejected' });
    const [blockedAgg] = await FraudLog.aggregate([
      { $match: { action: 'rejected' } },
      {
        $group: {
          _id: null,
          blockedOrderTotal: { $sum: '$orderTotal' },
          count: { $sum: 1 }
        }
      }
    ]);
    const [flaggedResolved] = await FraudLog.aggregate([
      {
        $match: {
          action: 'flagged',
          reviewAction: { $in: ['approved', 'rejected'] }
        }
      },
      { $count: 'n' }
    ]);

    return ok(res, 200, {
      data: {
        totalChecks,
        flaggedOpen,
        autoRejected,
        blockedOrderTotal: blockedAgg?.blockedOrderTotal || 0,
        autoRejectedCount: blockedAgg?.count || 0,
        flaggedManuallyResolved: flaggedResolved?.n || 0
      }
    });
  } catch (error) {
    console.error('Admin fraud stats error:', error);
    return fail(res, 500, error.message || 'Failed to load fraud stats');
  }
});

/**
 * PUT /api/admin/fraud/logs/:id/approve
 */
router.put('/logs/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return fail(res, 400, 'Invalid log id');

    const log = await FraudLog.findById(id);
    if (!log) return fail(res, 404, 'Fraud log not found');
    if (log.action !== 'flagged' || log.reviewAction === 'approved' || log.reviewAction === 'rejected') {
      return fail(res, 400, 'Log is not awaiting manual approval');
    }
    if (!log.orderId) return fail(res, 400, 'No order linked to this log');

    const order = await Order.findById(log.orderId);
    if (!order) return fail(res, 404, 'Order not found');
    if (order.status !== 'flagged') {
      return fail(res, 400, `Order is not flagged (status: ${order.status})`);
    }

    order.status = 'processing';
    await order.save();

    log.reviewAction = 'approved';
    log.reviewedAt = new Date();
    log.reviewedBy = req.authUserId || null;
    log.reviewNotes = String(req.body?.notes || '').slice(0, 2000);
    await log.save();

    const populated = await Order.findById(order._id).populate(ORDER_POPULATE);
    const user = await User.findById(order.user).select('name email');
    if (user?.email) {
      try {
        await sendOrderConfirmationEmail(user, populated);
      } catch (e) {
        console.error('[fraud approve] confirmation email:', e);
      }
    }

    return ok(res, 200, {
      message: 'Order approved and released for processing',
      data: { order: populated, fraudLog: log }
    });
  } catch (error) {
    console.error('Fraud approve error:', error);
    return fail(res, 500, error.message || 'Approve failed');
  }
});

/**
 * PUT /api/admin/fraud/logs/:id/reject — refund + stock rollback + mark rejected
 */
router.put('/logs/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return fail(res, 400, 'Invalid log id');

    const log = await FraudLog.findById(id);
    if (!log) return fail(res, 404, 'Fraud log not found');
    if (log.action !== 'flagged' || log.reviewAction === 'approved' || log.reviewAction === 'rejected') {
      return fail(res, 400, 'Log is not awaiting manual rejection');
    }
    if (!log.orderId) return fail(res, 400, 'No order linked to this log');

    const order = await Order.findById(log.orderId);
    if (!order) return fail(res, 404, 'Order not found');
    if (order.status !== 'flagged') {
      return fail(res, 400, `Order must be flagged for fraud reject (status: ${order.status})`);
    }

    const stripe = getStripe();
    if (stripe && order.stripePaymentIntentId && order.isPaid) {
      try {
        await stripe.refunds.create({
          payment_intent: order.stripePaymentIntentId
        });
      } catch (refErr) {
        console.error('[fraud reject] Stripe refund:', refErr);
        return fail(
          res,
          502,
          refErr.message || 'Refund failed — order was not updated.'
        );
      }
    }

    for (const line of order.orderItems) {
      await incrementStockRollback(line.product, line.quantity);
    }

    order.status = 'rejected';
    order.cancelReason = String(req.body?.reason || 'Rejected after fraud review').slice(
      0,
      1000
    );
    await order.save();

    log.reviewAction = 'rejected';
    log.reviewedAt = new Date();
    log.reviewedBy = req.authUserId || null;
    log.reviewNotes = String(req.body?.notes || '').slice(0, 2000);
    await log.save();

    const user = await User.findById(order.user).select('name email');
    if (user?.email) {
      try {
        await sendMail({
          to: user.email,
          subject: `Nova Shop — Order cancelled (${String(order._id).slice(-8)})`,
          text: [
            `Hi ${user.name},`,
            '',
            'After a manual review we could not release your order. Payment has been refunded where applicable.',
            order.cancelReason ? `Note: ${order.cancelReason}` : ''
          ]
            .filter(Boolean)
            .join('\n')
        });
      } catch (e) {
        console.error('[fraud reject] customer email:', e);
      }
    }

    const populated = await Order.findById(order._id).populate(ORDER_POPULATE);
    return ok(res, 200, {
      message: 'Order rejected and refunded',
      data: { order: populated, fraudLog: log }
    });
  } catch (error) {
    console.error('Fraud reject error:', error);
    return fail(res, 500, error.message || 'Reject failed');
  }
});

/**
 * POST /api/admin/fraud/blocklist
 */
router.post('/blocklist', async (req, res) => {
  try {
    const { type, value, reason, expiresAt } = req.body || {};
    const allowed = ['ip', 'email', 'card_fingerprint'];
    if (!allowed.includes(type)) {
      return fail(res, 400, `type must be one of: ${allowed.join(', ')}`);
    }
    if (value == null || String(value).trim() === '') {
      return fail(res, 400, 'value is required');
    }
    const v =
      type === 'email' || type === 'ip'
        ? String(value).trim().toLowerCase()
        : String(value).trim().toLowerCase();

    let exp = null;
    if (expiresAt) {
      const d = new Date(expiresAt);
      if (!Number.isNaN(d.getTime())) exp = d;
    }

    try {
      const doc = await Blocklist.create({
        type,
        value: v,
        reason: reason != null ? String(reason).slice(0, 500) : '',
        addedBy: req.authUserId || null,
        expiresAt: exp
      });
      return ok(res, 201, { message: 'Blocklist entry added', data: { entry: doc } });
    } catch (e) {
      if (e.code === 11000) {
        return fail(res, 409, 'That value is already on the blocklist');
      }
      throw e;
    }
  } catch (error) {
    console.error('Blocklist create error:', error);
    return fail(res, 500, error.message || 'Failed to add blocklist entry');
  }
});

/**
 * GET /api/admin/fraud/blocklist
 */
router.get('/blocklist', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;
    const type = req.query.type;
    const filter = {};
    if (type && ['ip', 'email', 'card_fingerprint'].includes(String(type))) {
      filter.type = String(type);
    }

    const [entries, totalCount] = await Promise.all([
      Blocklist.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('addedBy', 'name email')
        .lean(),
      Blocklist.countDocuments(filter)
    ]);

    return ok(res, 200, {
      data: {
        entries,
        totalCount,
        totalPages: Math.ceil(totalCount / limit) || 0,
        currentPage: page
      }
    });
  } catch (error) {
    console.error('Blocklist list error:', error);
    return fail(res, 500, error.message || 'Failed to list blocklist');
  }
});

/**
 * DELETE /api/admin/fraud/blocklist/:id — remove entry
 */
router.delete('/blocklist/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return fail(res, 400, 'Invalid id');
    const r = await Blocklist.findByIdAndDelete(id);
    if (!r) return fail(res, 404, 'Entry not found');
    return ok(res, 200, { message: 'Removed from blocklist' });
  } catch (error) {
    return fail(res, 500, error.message || 'Delete failed');
  }
});

module.exports = router;
