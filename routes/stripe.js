const express = require('express');
const mongoose = require('mongoose');
const { getStripe } = require('../lib/stripeClient');
const { requireJwtAuth } = require('../middleware/jwtAuth');
const User = require('../models/User');
const PaymentFailureLog = require('../models/PaymentFailureLog');
const { sendPaymentFailedEmail } = require('../lib/email');
const {
  buildPaymentIntentParams,
  finalizeOrderFromPaymentIntent
} = require('../services/orderFromPaymentIntent');

const router = express.Router();

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
      if (e.code === 'NO_STRIPE') {
        return fail(
          res,
          503,
          'Stripe is not configured. Set STRIPE_SECRET_KEY in environment.'
        );
      }
      if (e.code === 'EMPTY_CART') {
        return fail(res, 400, 'Cart is empty');
      }
      if (e.code === 'NO_STOCK') {
        return fail(res, 400, e.message, e.details);
      }
      if (
        e.code === 'PRODUCT_GONE' ||
        e.code === 'BAD_QTY' ||
        e.code === 'BAD_PRICE'
      ) {
        return fail(res, 400, e.message);
      }
      if (e.code === 'MIN_AMOUNT' || e.code === 'BAD_TOTAL') {
        return fail(res, 400, e.message);
      }
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
        try {
          await finalizeOrderFromPaymentIntent(pi, {});
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
  webhookHandler
};
