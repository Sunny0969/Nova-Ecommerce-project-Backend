const PendingOrderEmail = require('../models/PendingOrderEmail');
const Order = require('../models/Order');
const User = require('../models/User');
const {
  sendOrderConfirmationEmail,
  sendNewOrderAdminEmail,
  customerEmail,
  customerDisplayName
} = require('../lib/email');
const { ORDER_POPULATE } = require('./orderFromPaymentIntent');

const MAX_ATTEMPTS = 8;
const RETRY_MS = 90 * 1000;
const inFlight = new Set();
const scheduledOrders = new Set();

function emailResultSucceeded(result) {
  if (Array.isArray(result)) return result.some((row) => row?.sent === true);
  return result?.sent === true;
}

function isDeliveryComplete(pending, order, user, shippingOverride) {
  if (!pending?.adminNotified) return false;
  const hasCustomerEmail = Boolean(customerEmail(order, user, shippingOverride));
  return pending.customerNotified || !hasCustomerEmail;
}

/** Create pending row once — no upsert operators that can conflict. */
async function ensurePendingOrderEmail(orderId) {
  const existing = await PendingOrderEmail.findOne({ order: orderId });
  if (existing) return existing;

  try {
    return await PendingOrderEmail.create({
      order: orderId,
      status: 'pending',
      attempts: 0,
      customerNotified: false,
      adminNotified: false
    });
  } catch (err) {
    if (err.code === 11000) {
      return PendingOrderEmail.findOne({ order: orderId });
    }
    throw err;
  }
}

async function deliverPendingOrderEmail(orderId) {
  const id = String(orderId);
  if (inFlight.has(id)) return;
  inFlight.add(id);

  try {
    let pending = await ensurePendingOrderEmail(orderId);
    if (!pending) return;
    if (pending.status === 'sent') return;
    if (pending.customerNotified && pending.adminNotified) {
      await PendingOrderEmail.updateOne(
        { _id: pending._id },
        { $set: { status: 'sent', sentAt: pending.sentAt || new Date() } }
      );
      return;
    }
    if (pending.attempts >= MAX_ATTEMPTS) return;

    const order = await Order.findById(orderId).populate(ORDER_POPULATE);
    if (!order) {
      await PendingOrderEmail.updateOne(
        { _id: pending._id },
        { $set: { lastError: 'Order not found', status: 'failed' } }
      );
      return;
    }

    const user = await User.findById(order.user).select('name email');
    const shippingOverride = order.shippingAddress || undefined;

    if (!pending.customerNotified) {
      const to = customerEmail(order, user, shippingOverride);
      if (!to) {
        await PendingOrderEmail.updateOne({ _id: pending._id }, { $set: { customerNotified: true } });
      } else {
        const customer = {
          name: customerDisplayName(order, user, shippingOverride),
          email: to
        };
        const customerResult = await sendOrderConfirmationEmail(customer, order, shippingOverride);
        if (emailResultSucceeded(customerResult)) {
          await PendingOrderEmail.updateOne({ _id: pending._id }, { $set: { customerNotified: true } });
        }
      }
    }

    pending = await PendingOrderEmail.findById(pending._id);
    if (!pending.adminNotified) {
      const adminResult = await sendNewOrderAdminEmail(order, user, shippingOverride);
      if (emailResultSucceeded(adminResult)) {
        await PendingOrderEmail.updateOne({ _id: pending._id }, { $set: { adminNotified: true } });
      }
    }

    pending = await PendingOrderEmail.findById(pending._id);
    if (isDeliveryComplete(pending, order, user, shippingOverride)) {
      await PendingOrderEmail.updateOne(
        { _id: pending._id },
        { $set: { status: 'sent', sentAt: new Date(), lastError: '' } }
      );
      console.log('[email] Order notifications sent for', id);
      return;
    }

    await PendingOrderEmail.updateOne(
      { _id: pending._id },
      {
        $inc: { attempts: 1 },
        $set: {
          lastError: 'Waiting to retry unsent recipient',
          status: pending.attempts + 1 >= MAX_ATTEMPTS ? 'failed' : 'pending'
        }
      }
    );
  } catch (err) {
    console.error('[email] Order notification delivery error for', id, '—', err?.message || err);
    const doc = await PendingOrderEmail.findOne({ order: orderId }).catch(() => null);
    const failed = (doc?.attempts || 0) + 1 >= MAX_ATTEMPTS;
    await PendingOrderEmail.updateOne(
      { order: orderId, status: { $ne: 'sent' } },
      {
        $inc: { attempts: 1 },
        $set: {
          lastError: String(err?.message || err).slice(0, 500),
          status: failed ? 'failed' : 'pending'
        }
      }
    ).catch(() => {});
  } finally {
    inFlight.delete(id);
  }
}

async function enqueueOrderEmailsFromResult(result) {
  if (!result || result.duplicate || !result.populated?._id) return;
  await deliverPendingOrderEmail(result.populated._id);
}

function scheduleOrderEmailsFromResult(result, res) {
  if (!result || result.duplicate || !result.populated?._id) return;

  const orderId = String(result.populated._id);
  if (scheduledOrders.has(orderId)) return;

  const run = () => {
    if (scheduledOrders.has(orderId)) return;
    scheduledOrders.add(orderId);
    void enqueueOrderEmailsFromResult(result).catch((err) => {
      scheduledOrders.delete(orderId);
      console.error('[email] Failed to deliver order emails for', orderId, '—', err?.message || err);
    });
  };

  if (res && typeof res.once === 'function' && !res.writableEnded) {
    res.once('finish', run);
    return;
  }

  setImmediate(run);
}

async function retryPendingOrderEmails() {
  const pending = await PendingOrderEmail.find({
    status: { $in: ['pending', 'failed'] },
    attempts: { $lt: MAX_ATTEMPTS },
    $or: [{ customerNotified: false }, { adminNotified: false }]
  })
    .sort({ updatedAt: 1 })
    .limit(30)
    .select('order');

  for (const row of pending) {
    await deliverPendingOrderEmail(row.order);
  }
}

/** Queue emails for recent orders that never got a sent notification. */
async function backfillMissedOrderEmails() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const notifiedRows = await PendingOrderEmail.find({
    status: 'sent',
    customerNotified: true,
    adminNotified: true
  })
    .select('order')
    .lean();
  const notified = notifiedRows.map((row) => row.order);
  const recent = await Order.find({
    createdAt: { $gte: since },
    _id: { $nin: notified }
  })
    .sort({ createdAt: -1 })
    .limit(40)
    .select('_id');

  for (const row of recent) {
    await deliverPendingOrderEmail(row._id);
  }
}

function startOrderEmailRetryWorker() {
  void backfillMissedOrderEmails().catch((err) => {
    console.error('[email] Order email backfill failed:', err?.message || err);
  });
  void retryPendingOrderEmails().catch((err) => {
    console.error('[email] Initial pending order email sweep failed:', err?.message || err);
  });
  setInterval(() => {
    void retryPendingOrderEmails().catch((err) => {
      console.error('[email] Pending order email sweep failed:', err?.message || err);
    });
  }, RETRY_MS);
}

module.exports = {
  enqueueOrderEmailsFromResult,
  scheduleOrderEmailsFromResult,
  deliverPendingOrderEmail,
  retryPendingOrderEmails,
  backfillMissedOrderEmails,
  startOrderEmailRetryWorker
};
