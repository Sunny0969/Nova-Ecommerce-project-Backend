const express = require('express');
const router = express.Router();
const { getStripe } = require('../lib/stripeClient');
const {
  getWalletSummary,
  listWalletTransactions,
  creditWallet,
  getWalletBalance
} = require('../services/walletService');

function ok(res, payload) {
  res.json({ success: true, ...payload });
}

function fail(res, status, message) {
  res.status(status).json({ success: false, message });
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/** GET /api/wallet — balance + cashback offer */
router.get('/', async (req, res) => {
  try {
    const data = await getWalletSummary(req.authUserId);
    return ok(res, { data });
  } catch (err) {
    console.error('Wallet summary error:', err);
    return fail(res, 500, err.message || 'Could not load wallet');
  }
});

/** GET /api/wallet/transactions */
router.get('/transactions', async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const data = await listWalletTransactions(req.authUserId, { page, limit });
    return ok(res, { data });
  } catch (err) {
    console.error('Wallet transactions error:', err);
    return fail(res, 500, err.message || 'Could not load transactions');
  }
});

/** POST /api/wallet/top-up/intent — Stripe recharge */
router.post('/top-up/intent', async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return fail(res, 503, 'Card top-up is not available right now');
    }

    const amount = round2(Number(req.body.amount));
    if (!Number.isFinite(amount) || amount < 100) {
      return fail(res, 400, 'Minimum top-up is Rs 100');
    }
    if (amount > 500000) {
      return fail(res, 400, 'Maximum top-up is Rs 500,000 per transaction');
    }

    const currency = (process.env.STRIPE_CURRENCY || 'pkr').toLowerCase();
    const amountCents = Math.round(amount * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency,
      metadata: {
        type: 'wallet_topup',
        userId: String(req.authUserId),
        amountPkr: String(amount)
      },
      payment_method_types: ['card']
    });

    return ok(res, {
      message: 'Top-up started',
      data: {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount
      }
    });
  } catch (err) {
    console.error('Wallet top-up intent error:', err);
    return fail(res, 500, err.message || 'Could not start top-up');
  }
});

/** POST /api/wallet/top-up/confirm — credit wallet after successful card payment */
router.post('/top-up/confirm', async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return fail(res, 503, 'Card top-up is not available right now');
    }

    const paymentIntentId = String(req.body.paymentIntentId || '').trim();
    if (!paymentIntentId) {
      return fail(res, 400, 'paymentIntentId is required');
    }

    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.metadata?.type !== 'wallet_topup') {
      return fail(res, 400, 'Invalid payment intent');
    }
    if (String(pi.metadata.userId) !== String(req.authUserId)) {
      return fail(res, 403, 'Payment does not belong to this account');
    }
    if (pi.status !== 'succeeded') {
      return fail(res, 400, `Payment not completed (status: ${pi.status})`);
    }

    const amount = round2(Number(pi.metadata.amountPkr) || pi.amount / 100);
    const result = await creditWallet(req.authUserId, amount, {
      reason: 'top_up',
      description: `Wallet top-up via card`,
      referenceKey: `topup:${pi.id}`
    });

    return ok(res, {
      message: result.duplicate ? 'Top-up already credited' : 'Wallet topped up successfully',
      data: {
        balance: result.balance,
        transaction: result.transaction,
        duplicate: result.duplicate
      }
    });
  } catch (err) {
    console.error('Wallet top-up confirm error:', err);
    return fail(res, 500, err.message || 'Could not confirm top-up');
  }
});

/** POST /api/wallet/preview — checkout wallet application */
router.post('/preview', async (req, res) => {
  try {
    const { computeWalletApplication } = require('../services/walletService');
    const totalPrice = round2(Number(req.body.totalPrice));
    const useWallet = Boolean(req.body.useWallet);
    const balance = await getWalletBalance(req.authUserId);
    const applied = computeWalletApplication(totalPrice, balance, useWallet);
    return ok(res, { data: { balance, ...applied } });
  } catch (err) {
    console.error('Wallet preview error:', err);
    return fail(res, 500, err.message || 'Could not preview wallet');
  }
});

module.exports = router;
