const express = require('express');
const mongoose = require('mongoose');
const { getStripe } = require('../lib/stripeClient');
const { requireJwtAuth } = require('../middleware/jwtAuth');
const User = require('../models/User');
const PaymentFailureLog = require('../models/PaymentFailureLog');
const { sendPaymentFailedEmail } = require('../lib/email');
const { notifyOrderPlaced } = require('../lib/orderNotify');
const {
  buildPaymentIntentParams,
  buildGuestPaymentIntentParams,
  finalizeOrderFromPaymentIntent,
  finalizeGuestStripeOrder
} = require('../services/orderFromPaymentIntent');

const router = express.Router();
const guestRouter = express.Router();

function clientIpFromReq(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return (req.ip && String(req.ip)) || '';
}

function handlePaymentIntentErrors(e, res) {
  if (e.code === 'NO_STRIPE') {
    fail(res, 503, 'Stripe is not configured. Set STRIPE_SECRET_KEY in environment.');
    return true;
  }
  if (e.code === 'EMPTY_CART') {
    fail(res, 400, 'Cart is empty');
    return true;
  }
  if (e.code === 'NO_STOCK') {
    fail(res, 400, e.message, e.details);
    return true;
  }
  if (e.code === 'PRODUCT_GONE' || e.code === 'BAD_QTY' || e.code === 'BAD_PRICE') {
    fail(res, 400, e.message);
    return true;
  }
  if (e.code === 'MIN_AMOUNT' || e.code === 'BAD_TOTAL') {
    fail(res, 400, e.message);
    return true;
  }
  if (e.code === 'BAD_COUPON') {
    fail(res, 400, e.message);
    return true;
  }
  return false;
}

function ok(res, status, payload) {
  res.status(status).json({ success: true, ...payload });
}

function fail(res, status, message, errors) {
  const body = { success: false, message };
  if (errors && Object.keys(errors).length) body.errors = errors;
  res.status(status).json(body);
}

/**
 * POST /api/stripe/create-payment-intent (requires JWT)
 * Server computes amount from cart — never trust client totals.
 */
router.post('/create-payment-intent', requireJwtAuth, async (req, res) => {
  try {
    const deliveryOption = ['standard', 'express', 'nextday'].includes(
      req.body.deliveryOption
    )
      ? req.body.deliveryOption
      : 'standard';

    const shippingAddress =
      req.body.shippingAddress && typeof req.body.shippingAddress === 'object'
        ? req.body.shippingAddress
        : undefined;

    let result;
    try {
      result = await buildPaymentIntentParams(
        req.authUserId,
        deliveryOption,
        shippingAddress
      );
    } catch (e) {
      const handled = handlePaymentIntentErrors(e, res);
      if (handled) return;
      throw e;
    }

    const { paymentIntent, amountCents, currency } = result;

    return ok(res, 200, {
      message: 'Payment intent created',
      data: {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount: amountCents,
        currency,
        checkoutSummary: result.snapshotSummary
      }
    });
  } catch (error) {
    console.error('create-payment-intent error:', error);
    return fail(res, 500, error.message || 'Failed to create payment intent');
  }
});

/**
 * POST /api/stripe/guest/create-payment-intent — guest checkout (no JWT)
 */
guestRouter.post('/create-payment-intent', async (req, res) => {
  try {
    const deliveryOption = ['standard', 'express', 'nextday'].includes(req.body.deliveryOption)
      ? req.body.deliveryOption
      : 'standard';
    const shippingAddress =
      req.body.shippingAddress && typeof req.body.shippingAddress === 'object'
        ? req.body.shippingAddress
        : undefined;
    const items = req.body.items;
    const couponCode = req.body.couponCode != null ? String(req.body.couponCode).trim() : '';

    let result;
    try {
      result = await buildGuestPaymentIntentParams(items, deliveryOption, shippingAddress, couponCode || null);
    } catch (e) {
      const handled = handlePaymentIntentErrors(e, res);
      if (handled) return;
      throw e;
    }

    const { paymentIntent, amountCents, currency } = result;
    return ok(res, 200, {
      message: 'Payment intent created',
      data: {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount: amountCents,
        currency,
        checkoutSummary: result.snapshotSummary
      }
    });
  } catch (error) {
    console.error('guest create-payment-intent error:', error);
    return fail(res, 500, error.message || 'Failed to create payment intent');
  }
});

/**
 * POST /api/stripe/guest/confirm — finalize guest order after card payment
 */
guestRouter.post('/confirm', async (req, res) => {
  try {
    const { paymentIntentId, deliveryOption, shippingAddress, items, couponCode } = req.body;
    if (!paymentIntentId || typeof paymentIntentId !== 'string') {
      return fail(res, 400, 'paymentIntentId is required');
    }

    let result;
    try {
      result = await finalizeGuestStripeOrder(
        paymentIntentId,
        items,
        ['standard', 'express', 'nextday'].includes(deliveryOption) ? deliveryOption : 'standard',
        shippingAddress && typeof shippingAddress === 'object' ? shippingAddress : {},
        clientIpFromReq(req),
        couponCode != null ? String(couponCode).trim() : null
      );
    } catch (e) {
      if (e.code === 'EMPTY_CART') return fail(res, 400, 'Cart is empty');
      if (e.code === 'AMOUNT_MISMATCH') return fail(res, 409, e.message);
      if (e.code === 'STOCK') return fail(res, 409, e.message);
      if (e.code === 'BAD_EMAIL') return fail(res, 400, e.message);
      if (e.code === 'BAD_COUPON') return fail(res, 400, e.message);
      if (e.code === 'NOT_SUCCEEDED' || e.code === 'BAD_METADATA') return fail(res, 400, e.message);
      throw e;
    }

    const status = result.duplicate ? 200 : 201;
    notifyOrderPlaced(result, res, req);
    return ok(res, status, {
      message: result.duplicate ? 'Order already recorded' : 'Order placed successfully',
      data: { order: result.populated, duplicate: result.duplicate }
    });
  } catch (error) {
    console.error('guest stripe confirm error:', error);
    return fail(res, 500, error.message || 'Failed to confirm order');
  }
});

/**
 * POST /api/stripe/webhook — raw body only; mounted in server.js BEFORE express.json
 */
async function webhookHandler(req, res) {
  const stripe = getStripe();
  if (!stripe) {
    console.error('[stripe webhook] STRIPE_SECRET_KEY missing');
    return res.status(503).send('Stripe not configured');
  }

  const sig = req.headers['stripe-signature'];
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!whSecret) {
    console.error('[stripe webhook] STRIPE_WEBHOOK_SECRET missing');
    return res.status(503).send('Webhook secret not configured');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, whSecret);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        if (pi.metadata?.type === 'wallet_topup') {
          const userId = pi.metadata?.userId;
          const amount = Math.round(Number(pi.metadata.amountPkr || pi.amount / 100) * 100) / 100;
          if (userId && mongoose.Types.ObjectId.isValid(userId) && amount > 0) {
            try {
              const { creditWallet } = require('../services/walletService');
              await creditWallet(userId, amount, {
                reason: 'top_up',
                description: 'Wallet top-up via card',
                referenceKey: `topup:${pi.id}`
              });
            } catch (walletErr) {
              console.error('[webhook] wallet top-up:', walletErr);
            }
          }
          return res.status(200).json({ received: true, walletTopUp: true });
        }
        try {
          const result = await finalizeOrderFromPaymentIntent(pi, {});
          notifyOrderPlaced(result, res, req);
        } catch (e) {
          console.error('[webhook] finalizeOrderFromPaymentIntent:', e);
          if (e.code === 'AMOUNT_MISMATCH' || e.code === 'EMPTY_CART') {
            return res.status(200).json({
              received: true,
              warning: e.message
            });
          }
          if (e.code === 'FRAUD_REJECT') {
            return res.status(200).json({
              received: true,
              fraudRejected: true,
              message: e.message
            });
          }
          return res.status(500).json({
            received: false,
            error: e.message || 'Order finalize failed'
          });
        }
        break;
      }
      case 'payment_intent.payment_failed': {
        const pi = event.data.object;
        const userId = pi.metadata?.userId;
        if (userId && mongoose.Types.ObjectId.isValid(userId)) {
          try {
            await PaymentFailureLog.create({
              user: new mongoose.Types.ObjectId(userId),
              stripePaymentIntentId: pi.id
            });
          } catch (pe) {
            if (pe.code !== 11000) console.error('[webhook] PaymentFailureLog:', pe);
          }
          const user = await User.findById(userId).select('name email');
          if (user?.email) {
            try {
              await sendPaymentFailedEmail(user, pi);
            } catch (mailErr) {
              console.error('payment_failed notify email error:', mailErr);
            }
          }
        }
        break;
      }
      default:
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Stripe webhook handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = {
  router,
  guestRouter,
  webhookHandler
};
