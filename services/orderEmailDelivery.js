const PendingOrderEmail = require('../models/PendingOrderEmail');
const Order = require('../models/Order');
const User = require('../models/User');
const { sendOrderPlacedEmails } = require('../lib/email');
const { ORDER_POPULATE } = require('./orderFromPaymentIntent');

const MAX_ATTEMPTS = 6;
const RETRY_MS = 2 * 60 * 1000;
const inFlight = new Set();

function shippingSnapshotFromResult(result) {
  if (result?.emailNotify?.addr && typeof result.emailNotify.addr === 'object') {
    return { ...result.emailNotify.addr };
  }
  const ship = result?.populated?.shippingAddress;
  if (ship && typeof ship === 'object') {
    return typeof ship.toObject === 'function' ? ship.toObject() : { ...ship };
  }
  return null;
}

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

async function deliverPendingOrderEmail(orderId) {
  const id = String(orderId);
  if (inFlight.has(id)) return;
  inFlight.add(id);

  try {
    let pending = await PendingOrderEmail.findOne({ order: orderId });
    if (pending?.status === 'sent') return;

    if (!pending) {
      pending = await PendingOrderEmail.create({
        order: orderId,
        status: 'pending',
        attempts: 0
      });
    } else if (pending.status === 'failed' || pending.attempts >= MAX_ATTEMPTS) {
      return;
    }

    pending = await PendingOrderEmail.findOneAndUpdate(
      { _id: pending._id, status: { $ne: 'sent' } },
      { $inc: { attempts: 1 }, $set: { lastError: '' } },
      { new: true }
    );
    if (!pending) return;

    const order = await Order.findById(orderId).populate(ORDER_POPULATE);
    if (!order) {
      await PendingOrderEmail.updateOne(
        { _id: pending._id },
        { $set: { lastError: 'Order not found', status: 'failed' } }
      );
      return;
    }

    const user = await User.findById(order.user).select('name email');
    const shippingOverride = pending.shippingSnapshot || undefined;

    const results = await sendOrderPlacedEmails(order, user, shippingOverride);
    if (deliverySucceeded(results)) {
      await PendingOrderEmail.updateOne(
        { _id: pending._id },
        { $set: { status: 'sent', sentAt: new Date(), lastError: '' } }
      );
      console.log('[email] Order notifications sent for', id);
      return;
    }

    const reason =
      results?.adminResult?.reason ||
      results?.customerResult?.reason ||
      'Unknown email delivery failure';
    const failed = pending.attempts >= MAX_ATTEMPTS;
    await PendingOrderEmail.updateOne(
      { _id: pending._id },
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
  const shippingSnapshot = shippingSnapshotFromResult(result);

  const update = {
    $setOnInsert: {
      order: orderId,
      status: 'pending',
      attempts: 0
    }
  };
  if (shippingSnapshot) {
    update.$set = { shippingSnapshot };
  }

  await PendingOrderEmail.findOneAndUpdate({ order: orderId }, update, { upsert: true, new: true });

  void deliverPendingOrderEmail(orderId);
}

function scheduleOrderEmailsFromResult(result, res) {
  if (!result || result.duplicate || !result.populated?._id) return;

  const orderId = String(result.populated._id);
  let scheduled = false;

  const run = () => {
    if (scheduled) return;
    scheduled = true;
    void enqueueOrderEmailsFromResult(result).catch((err) => {
      scheduled = false;
      console.error('[email] Failed to enqueue order emails for', orderId, '—', err?.message || err);
    });
  };

  if (res && typeof res.once === 'function' && !res.writableEnded) {
    res.once('finish', run);
    res.once('close', run);
    setTimeout(run, 2000);
    return;
  }

  setImmediate(run);
}

async function retryPendingOrderEmails() {
  const pending = await PendingOrderEmail.find({
    status: 'pending',
    attempts: { $lt: MAX_ATTEMPTS }
  })
    .sort({ updatedAt: 1 })
    .limit(25)
    .select('order');

  for (const row of pending) {
    await deliverPendingOrderEmail(row.order);
  }
}

function startOrderEmailRetryWorker() {
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
  startOrderEmailRetryWorker
};
