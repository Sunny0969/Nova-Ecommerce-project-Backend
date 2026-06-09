const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Cart = require('../models/Cart');
const Coupon = require('../models/Coupon');
const User = require('../models/User');
const FraudLog = require('../models/FraudLog');
const Blocklist = require('../models/Blocklist');
const { buildCheckoutSnapshot, buildGuestCheckoutSnapshot } = require('../utils/checkout');
const { resolveGuestCheckoutUser } = require('../lib/guestCheckoutUser');
const { getStripe } = require('../lib/stripeClient');
const {
  analyzeOrderRisk,
  tierToAction,
  extractCardFingerprint
} = require('./fraudDetection');
const {
  sendNewOrderAdminEmail,
  sendFraudFlaggedAdminEmail,
  sendOrderHeldForFraudReviewEmail,
  toPlainDoc
} = require('../lib/email');

const ORDER_POPULATE = [
  { path: 'user', select: 'name email' },
  {
    path: 'orderItems.product',
    select: 'name slug images price'
  },
  { path: 'coupon', select: 'code discountType' }
];

async function decrementStockAtomic(productId, qty) {
  return Product.findOneAndUpdate(
    { _id: productId, stock: { $gte: qty } },
    [
      {
        $set: {
          stock: { $subtract: ['$stock', qty] }
        }
      }
    ],
    { new: true }
  ).lean();
}

async function incrementStockRollback(productId, qty) {
  await Product.findOneAndUpdate(
    { _id: productId },
    [
      {
        $set: {
          stock: { $add: ['$stock', qty] }
        }
      }
    ]
  );
}

function parseShippingFromMetadata(pi) {
  const raw = pi.metadata?.shipping_json;
  if (!raw || typeof raw !== 'string') return {};
  try {
    const o = JSON.parse(raw);
    return typeof o === 'object' && o ? o : {};
  } catch {
    return {};
  }
}

async function safeCreateFraudLog(doc) {
  try {
    await FraudLog.create(doc);
  } catch (e) {
    if (e && e.code === 11000) return;
    throw e;
  }
}

/**
 * Creates a Stripe PaymentIntent from the user's cart (server-side totals only).
 * @param {string} userId
 * @param {string} deliveryOption
 * @param {object} [shippingAddress] — optional; stored in PI metadata when small enough for webhook
 */
async function buildPaymentIntentParams(userId, deliveryOption, shippingAddress) {
  const stripe = getStripe();
  if (!stripe) {
    const err = new Error('Stripe is not configured');
    err.code = 'NO_STRIPE';
    throw err;
  }

  let snapshot;
  try {
    snapshot = await buildCheckoutSnapshot(userId, deliveryOption);
  } catch (e) {
    if (e.code) throw e;
    throw e;
  }

  const currency = (process.env.STRIPE_CURRENCY || 'usd').toLowerCase();
  const amountCents = Math.round(snapshot.totalPrice * 100);

  if (currency === 'usd' && amountCents < 50) {
    const err = new Error('Order total is below the minimum charge amount');
    err.code = 'MIN_AMOUNT';
    throw err;
  }
  if (currency === 'pkr' && amountCents < 100) {
    const err = new Error('Order total is below the minimum charge amount');
    err.code = 'MIN_AMOUNT';
    throw err;
  }
  if (amountCents < 1) {
    const err = new Error('Invalid order total');
    err.code = 'BAD_TOTAL';
    throw err;
  }

  const metadata = {
    userId: String(userId),
    deliveryOption: deliveryOption || 'standard'
  };

  if (shippingAddress && typeof shippingAddress === 'object') {
    const json = JSON.stringify(shippingAddress);
    if (json.length <= 490) {
      metadata.shipping_json = json;
    }
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency,
    metadata,
    payment_method_types: ['card']
  });

  return {
    paymentIntent,
    amountCents,
    currency,
    snapshotSummary: {
      totalPrice: snapshot.totalPrice,
      itemsPrice: snapshot.itemsPrice,
      shippingPrice: snapshot.shippingPrice,
      taxPrice: snapshot.taxPrice,
      discountAmount: snapshot.discountAmount
    }
  };
}

/**
 * Finalizes order after successful payment. Idempotent per PaymentIntent id.
 * @param {import('stripe').Stripe.PaymentIntent} pi
 * @param {{ shippingAddress?: object, clientIp?: string, billingAddress?: object, fraudPrecomputed?: object }} [options]
 */
async function finalizeOrderFromPaymentIntent(pi, options = {}) {
  const existing = await Order.findOne({ stripePaymentIntentId: pi.id });
  if (existing) {
    const populated = await Order.findById(existing._id).populate(ORDER_POPULATE);
    return { order: existing, populated, duplicate: true };
  }

  const priorFraudReject = await FraudLog.findOne({
    stripePaymentIntentId: pi.id,
    action: 'rejected'
  })
    .select('_id')
    .lean();
  if (priorFraudReject) {
    const err = new Error(
      'This payment was blocked by fraud checks. If you were charged, a refund was issued. Contact support if you need help.'
    );
    err.code = 'FRAUD_REJECT';
    throw err;
  }

  const userId = pi.metadata?.userId;
  if (!userId) {
    const err = new Error('PaymentIntent missing userId metadata');
    err.code = 'BAD_METADATA';
    throw err;
  }

  if (pi.status !== 'succeeded') {
    const err = new Error(`Payment not succeeded (status: ${pi.status})`);
    err.code = 'NOT_SUCCEEDED';
    throw err;
  }

  const deliveryOption = pi.metadata?.deliveryOption || 'standard';
  const envCurrency = (process.env.STRIPE_CURRENCY || 'usd').toLowerCase();
  if ((pi.currency || 'usd').toLowerCase() !== envCurrency) {
    const err = new Error('Currency mismatch');
    err.code = 'CURRENCY';
    throw err;
  }

  let snapshot;
  try {
    snapshot = await buildCheckoutSnapshot(userId, deliveryOption);
  } catch (e) {
    if (e.code === 'EMPTY_CART') {
      const err = new Error('Cart is empty — cannot create order');
      err.code = 'EMPTY_CART';
      throw err;
    }
    throw e;
  }

  const expectedCents = Math.round(snapshot.totalPrice * 100);
  if (pi.amount !== expectedCents) {
    const err = new Error('Cart total no longer matches payment amount');
    err.code = 'AMOUNT_MISMATCH';
    throw err;
  }

  const metaAddr = parseShippingFromMetadata(pi);
  const addr = {
    ...metaAddr,
    ...(options.shippingAddress && typeof options.shippingAddress === 'object'
      ? options.shippingAddress
      : {})
  };

  const stripe = getStripe();
  if (!stripe) {
    const err = new Error('Stripe is not configured');
    err.code = 'NO_STRIPE';
    throw err;
  }

  const piFull = await stripe.paymentIntents.retrieve(pi.id, {
    expand: ['payment_method']
  });

  const clientIp = options.clientIp ? String(options.clientIp).split(',')[0].trim() : '';
  const billingAddr =
    options.billingAddress && typeof options.billingAddress === 'object'
      ? options.billingAddress
      : {};

  let fraudResult =
    options.fraudPrecomputed ||
    (await analyzeOrderRisk({
      paymentIntent: piFull,
      userId,
      clientIp,
      shippingAddress: addr,
      billingAddress: billingAddr,
      snapshot,
      deliveryOption,
      currency: pi.currency || envCurrency
    }));

  if (fraudResult.tier === 'reject') {
    try {
      await stripe.refunds.create({ payment_intent: pi.id });
    } catch (refErr) {
      console.error('[fraud] Refund after reject failed:', refErr);
    }
    if (clientIp) {
      try {
        await Blocklist.create({
          type: 'ip',
          value: clientIp.toLowerCase(),
          reason: 'Auto-block: fraud score ≥71',
          addedBy: null,
          expiresAt: null
        });
      } catch (blErr) {
        if (blErr.code !== 11000) console.error('[fraud] Blocklist insert:', blErr);
      }
    }
    await safeCreateFraudLog({
      orderId: null,
      userId: new mongoose.Types.ObjectId(userId),
      ipAddress: clientIp,
      stripePaymentIntentId: pi.id,
      riskScore: fraudResult.score,
      riskFactors: fraudResult.factors,
      action: 'rejected',
      orderTotal: snapshot.totalPrice,
      currency: String(pi.currency || envCurrency).toLowerCase()
    });
    const err = new Error(
      'Order blocked by automated fraud checks. If a charge appeared, a refund has been issued.'
    );
    err.code = 'FRAUD_REJECT';
    throw err;
  }

  const orderStatus = fraudResult.tier === 'flag' ? 'flagged' : 'processing';
  const cardFp = fraudResult.cardFingerprint || extractCardFingerprint(piFull);

  const decremented = [];
  const userObjectId = new mongoose.Types.ObjectId(userId);

  try {
    for (const line of snapshot.orderLines) {
      const updated = await decrementStockAtomic(line.product, line.quantity);
      if (!updated) {
        for (const d of decremented.reverse()) {
          await incrementStockRollback(d.productId, d.qty);
        }
        const err = new Error('Insufficient stock while completing order');
        err.code = 'STOCK';
        throw err;
      }
      decremented.push({ productId: line.product, qty: line.quantity });
    }

    const order = await Order.create({
      user: userObjectId,
      orderItems: snapshot.orderLines,
      shippingAddress: {
        firstName: addr.firstName ?? '',
        lastName: addr.lastName ?? '',
        street: addr.street ?? '',
        city: addr.city ?? '',
        state: addr.state ?? '',
        zipCode: addr.zipCode ?? '',
        country: addr.country ?? '',
        phone: addr.phone ?? '',
        email: addr.email != null ? String(addr.email).trim().slice(0, 200) : ''
      },
      deliveryOption: deliveryOption || 'standard',
      paymentMethod: 'stripe',
      paymentResult: {
        id: pi.id,
        status: pi.status,
        update_time: new Date().toISOString(),
        email_address: ''
      },
      itemsPrice: snapshot.itemsPrice,
      taxPrice: snapshot.taxPrice,
      shippingPrice: snapshot.shippingPrice,
      totalPrice: snapshot.totalPrice,
      discountAmount: snapshot.discountAmount,
      coupon: snapshot.couponId || undefined,
      isPaid: true,
      paidAt: new Date(),
      status: orderStatus,
      stripePaymentIntentId: pi.id,
      clientIp,
      paymentCardFingerprint: cardFp || undefined,
      fraudRiskScore: fraudResult.score,
      fraudFactors: Array.isArray(fraudResult.factors) ? fraudResult.factors : []
    });

    try {
      if (snapshot.couponId) {
        await Coupon.findByIdAndUpdate(snapshot.couponId, {
          $inc: { usedCount: 1 }
        });
      }

      await Cart.findOneAndUpdate(
        { user: userObjectId },
        { $set: { items: [], coupon: null, discountAmount: 0 } }
      );
    } catch (afterErr) {
      await Order.deleteOne({ _id: order._id });
      for (const d of decremented.reverse()) {
        await incrementStockRollback(d.productId, d.qty);
      }
      if (snapshot.couponId) {
        await Coupon.findByIdAndUpdate(snapshot.couponId, {
          $inc: { usedCount: -1 }
        });
      }
      throw afterErr;
    }

    const [populated, user] = await Promise.all([
      Order.findById(order._id).populate(ORDER_POPULATE),
      User.findById(userId).select('name email')
    ]);

    await safeCreateFraudLog({
      orderId: order._id,
      userId: userObjectId,
      ipAddress: clientIp,
      stripePaymentIntentId: pi.id,
      riskScore: fraudResult.score,
      riskFactors: fraudResult.factors,
      action: tierToAction(fraudResult.tier),
      orderTotal: snapshot.totalPrice,
      currency: String(pi.currency || envCurrency).toLowerCase()
    });

    const orderShipAddr = order.shippingAddress || {};
    let emailNotify;
    if (orderStatus === 'flagged') {
      const plainOrder = toPlainDoc(populated);
      const plainUser = toPlainDoc(user);
      setImmediate(() => {
        void (async () => {
          try {
            if (plainUser?.email || orderShipAddr.email) {
              await sendOrderHeldForFraudReviewEmail(
                plainUser || { name: orderShipAddr.firstName, email: orderShipAddr.email },
                plainOrder
              );
            }
            const adminTo = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;
            if (adminTo) {
              await Promise.all([
                sendFraudFlaggedAdminEmail(adminTo, {
                  orderId: String(order._id),
                  riskScore: fraudResult.score,
                  factors: fraudResult.factors,
                  userEmail: orderShipAddr.email || plainUser?.email || ''
                }),
                sendNewOrderAdminEmail(plainOrder, plainUser, orderShipAddr)
              ]);
            }
          } catch (mailErr) {
            console.error('Order / fraud notification email failed:', mailErr);
          }
        })();
      });
    } else {
      emailNotify = { user, addr: orderShipAddr };
    }

    return { order, populated, duplicate: false, emailNotify };
  } catch (err) {
    for (const d of decremented.reverse()) {
      try {
        await incrementStockRollback(d.productId, d.qty);
      } catch (rollbackErr) {
        console.error('Stock rollback error:', rollbackErr);
      }
    }
    throw err;
  }
}

function normalizeGuestItems(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((line) => ({
      productId: String(line.productId || line.product || '').trim(),
      quantity: Math.max(1, Math.floor(Number(line.quantity) || 1)),
      price: line.price != null ? Number(line.price) : undefined
    }))
    .filter((line) => line.productId);
}

/**
 * Guest checkout — PaymentIntent from browser cart (no JWT).
 */
async function buildGuestPaymentIntentParams(guestItems, deliveryOption, shippingAddress) {
  const stripe = getStripe();
  if (!stripe) {
    const err = new Error('Stripe is not configured');
    err.code = 'NO_STRIPE';
    throw err;
  }

  const items = normalizeGuestItems(guestItems);
  if (!items.length) {
    const err = new Error('Cart is empty');
    err.code = 'EMPTY_CART';
    throw err;
  }

  let snapshot;
  try {
    snapshot = await buildGuestCheckoutSnapshot(items, deliveryOption);
  } catch (e) {
    if (e.code) throw e;
    throw e;
  }

  const currency = (process.env.STRIPE_CURRENCY || 'usd').toLowerCase();
  const amountCents = Math.round(snapshot.totalPrice * 100);

  if (currency === 'usd' && amountCents < 50) {
    const err = new Error('Order total is below the minimum charge amount');
    err.code = 'MIN_AMOUNT';
    throw err;
  }
  if (currency === 'pkr' && amountCents < 100) {
    const err = new Error('Order total is below the minimum charge amount');
    err.code = 'MIN_AMOUNT';
    throw err;
  }
  if (amountCents < 1) {
    const err = new Error('Invalid order total');
    err.code = 'BAD_TOTAL';
    throw err;
  }

  const metadata = {
    guestCheckout: '1',
    deliveryOption: deliveryOption || 'standard'
  };

  if (shippingAddress && typeof shippingAddress === 'object') {
    const json = JSON.stringify(shippingAddress);
    if (json.length <= 490) {
      metadata.shipping_json = json;
    }
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency,
    metadata,
    payment_method_types: ['card']
  });

  return {
    paymentIntent,
    amountCents,
    currency,
    snapshotSummary: {
      totalPrice: snapshot.totalPrice,
      itemsPrice: snapshot.itemsPrice,
      shippingPrice: snapshot.shippingPrice,
      taxPrice: snapshot.taxPrice,
      discountAmount: snapshot.discountAmount
    }
  };
}

/**
 * Finalize guest order after Stripe payment (client confirm).
 */
async function finalizeGuestStripeOrder(
  paymentIntentId,
  guestItems,
  deliveryOption,
  shippingAddress,
  clientIp = ''
) {
  const stripe = getStripe();
  if (!stripe) {
    const err = new Error('Stripe is not configured');
    err.code = 'NO_STRIPE';
    throw err;
  }

  const items = normalizeGuestItems(guestItems);
  if (!items.length) {
    const err = new Error('Cart is empty');
    err.code = 'EMPTY_CART';
    throw err;
  }

  const existing = await Order.findOne({ stripePaymentIntentId: paymentIntentId });
  if (existing) {
    const populated = await Order.findById(existing._id).populate(ORDER_POPULATE);
    return { order: existing, populated, duplicate: true };
  }

  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (pi.metadata?.guestCheckout !== '1') {
    const err = new Error('Invalid guest payment');
    err.code = 'BAD_METADATA';
    throw err;
  }
  if (pi.status !== 'succeeded') {
    const err = new Error(`Payment not succeeded (status: ${pi.status})`);
    err.code = 'NOT_SUCCEEDED';
    throw err;
  }

  const snapshot = await buildGuestCheckoutSnapshot(items, deliveryOption);
  const expectedCents = Math.round(snapshot.totalPrice * 100);
  if (pi.amount !== expectedCents) {
    const err = new Error('Cart total no longer matches payment amount');
    err.code = 'AMOUNT_MISMATCH';
    throw err;
  }

  const addr =
    shippingAddress && typeof shippingAddress === 'object'
      ? shippingAddress
      : parseShippingFromMetadata(pi);

  const userId = await resolveGuestCheckoutUser(addr);
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const decremented = [];

  try {
    for (const line of snapshot.orderLines) {
      const updated = await decrementStockAtomic(line.product, line.quantity);
      if (!updated) {
        for (const d of decremented.reverse()) {
          await incrementStockRollback(d.productId, d.qty);
        }
        const err = new Error('Insufficient stock while completing order');
        err.code = 'STOCK';
        throw err;
      }
      decremented.push({ productId: line.product, qty: line.quantity });
    }

    const order = await Order.create({
      user: userObjectId,
      orderItems: snapshot.orderLines,
      shippingAddress: {
        firstName: addr.firstName ?? '',
        lastName: addr.lastName ?? '',
        street: addr.street ?? '',
        city: addr.city ?? '',
        state: addr.state ?? '',
        zipCode: addr.zipCode ?? '',
        country: addr.country ?? '',
        phone: addr.phone ?? '',
        email: addr.email != null ? String(addr.email).trim().slice(0, 200) : ''
      },
      deliveryOption: deliveryOption || 'standard',
      paymentMethod: 'stripe',
      paymentResult: {
        id: pi.id,
        status: pi.status,
        update_time: new Date().toISOString(),
        email_address: addr.email ?? ''
      },
      itemsPrice: snapshot.itemsPrice,
      taxPrice: snapshot.taxPrice,
      shippingPrice: snapshot.shippingPrice,
      totalPrice: snapshot.totalPrice,
      discountAmount: snapshot.discountAmount,
      isPaid: true,
      paidAt: new Date(),
      status: 'processing',
      stripePaymentIntentId: pi.id,
      clientIp: clientIp ? String(clientIp).split(',')[0].trim() : ''
    });

    const [populated, user] = await Promise.all([
      Order.findById(order._id).populate(ORDER_POPULATE),
      User.findById(userId).select('name email')
    ]);

    return { order, populated, duplicate: false, emailNotify: { user, addr } };
  } catch (err) {
    for (const d of decremented.reverse()) {
      try {
        await incrementStockRollback(d.productId, d.qty);
      } catch (rollbackErr) {
        console.error('Stock rollback error:', rollbackErr);
      }
    }
    throw err;
  }
}

module.exports = {
  buildPaymentIntentParams,
  buildGuestPaymentIntentParams,
  finalizeOrderFromPaymentIntent,
  finalizeGuestStripeOrder,
  ORDER_POPULATE
};
