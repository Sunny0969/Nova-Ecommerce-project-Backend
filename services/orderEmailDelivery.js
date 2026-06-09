const PendingOrderEmail = require('../models/PendingOrderEmail');
const Order = require('../models/Order');
const User = require('../models/User');
const { sendOrderPlacedEmails } = require('../lib/email');
const { ORDER_POPULATE } = require('./orderFromPaymentIntent');

const MAX_ATTEMPTS = 8;
const RETRY_MS = 90 * 1000;
const inFlight = new Set();

function deliverySucceeded(results) {
  if (
    results?.adminResult?.reason === 'not_configured' ||
    results?.customerResult?.reason === 'not_configured'
  ) {
    return false;
  }
  const customerSent = results?.customerResult?.sent === true;
  const adminSent = results?.adminResult?.sent === true;
  const customerSkippedNoEmail =
    results?.customerResult?.skipped === true &&
    results?.customerResult?.reason !== 'not_configured';
  return adminSent && (customerSent || customerSkippedNoEmail);
}

/** Create pending row once — no upsert operators that can conflict. */
async function ensurePendingOrderEmail(orderId) {
  const existing = await PendingOrderEmail.findOne({ order: orderId });
  if (existing) return existing;

  try {
    return await PendingOrderEmail.create({
      order: orderId,
      status: 'pending',
      attempts: 0
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
    const pending = await ensurePendingOrderEmail(orderId);
    if (!pending || pending.status === 'sent') return;
    if (pending.attempts >= MAX_ATTEMPTS) return;

    const claimed = await PendingOrderEmail.findOneAndUpdate(
      { _id: pending._id, status: { $ne: 'sent' }, attempts: { $lt: MAX_ATTEMPTS } },
      { $inc: { attempts: 1 }, $set: { lastError: '', status: 'pending' } },
      { new: true }
    );
    if (!claimed) return;

    const order = await Order.findById(orderId).populate(ORDER_POPULATE);
    if (!order) {
      await PendingOrderEmail.updateOne(
        { _id: claimed._id },
        { $set: { lastError: 'Order not found', status: 'failed' } }
      );
      return;
    }

    const user = await User.findById(order.user).select('name email');
    const shippingOverride = order.shippingAddress || undefined;

    const results = await sendOrderPlacedEmails(order, user, shippingOverride);
    if (deliverySucceeded(results)) {
      await PendingOrderEmail.updateOne(
        { _id: claimed._id },
        { $set: { status: 'sent', sentAt: new Date(), lastError: '' } }
      );
      console.log('[email] Order notifications sent for', id);
      return;
    }

    const reason =
      results?.adminResult?.reason ||
      results?.customerResult?.reason ||
      'Unknown email delivery failure';
    const failed = claimed.attempts >= MAX_ATTEMPTS;
    await PendingOrderEmail.updateOne(
      { _id: claimed._id },
      {
        $set: {
          lastError: String(reason).slice(0, 500),
          status: failed ? 'failed' : 'pending'
        }
      }
    );
    console.warn('[email] Order notification attempt failed for', id, '—', reason);
  } catch (err) {
    console.error('[email] Order notification delivery error for', id, '—', err?.message || err);
    const doc = await PendingOrderEmail.findOne({ order: orderId }).catch(() => null);
    const failed = (doc?.attempts || 0) >= MAX_ATTEMPTS;
    await PendingOrderEmail.updateOne(
      { order: orderId, status: { $ne: 'sent' } },
      {
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
  const orderId = result.populated._id;
  await ensurePendingOrderEmail(orderId);
  await deliverPendingOrderEmail(orderId);
}

function scheduleOrderEmailsFromResult(result, res) {
  if (!result || result.duplicate || !result.populated?._id) return;

  const orderId = String(result.populated._id);
  let started = false;

  const run = () => {
    if (started) return;
    started = true;
    void enqueueOrderEmailsFromResult(result).catch((err) => {
      started = false;
      console.error('[email] Failed to deliver order emails for', orderId, '—', err?.message || err);
    });
  };

  if (res && typeof res.once === 'function' && !res.writableEnded) {
    res.once('finish', run);
    setTimeout(run, 1500);
    return;
  }

  setImmediate(run);
}

async function retryPendingOrderEmails() {
  const pending = await PendingOrderEmail.find({
    status: { $in: ['pending', 'failed'] },
    attempts: { $lt: MAX_ATTEMPTS }
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
  const notified = await PendingOrderEmail.find({ status: 'sent' }).distinct('order');
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
