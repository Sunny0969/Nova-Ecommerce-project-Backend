const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const router = express.Router();

const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const { getStripe } = require('../lib/stripeClient');
const { sendOrderCancelledEmail } = require('../lib/email');
const { notifyOrderPlaced } = require('../lib/orderNotify');
const { refundOrderToWallet } = require('../services/walletService');
const {
  finalizeOrderFromPaymentIntent,
  ORDER_POPULATE
} = require('../services/orderFromPaymentIntent');
const { finalizeOrderWithManualPayment } = require('../services/orderManualPayment');
const { isAllowedManualPaymentMethod, EASYPAISA_NUMBER } = require('../lib/paymentConfig');
const { uploadImageBuffer, ensureConfigured } = require('../lib/cloudinary');
const { hydratePaymentProof } = require('../utils/paymentProof');

const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      cb(new Error('Only image uploads are allowed'));
      return;
    }
    cb(null, true);
  }
});

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function isBankTransferOrder(order) {
  const id = order.paymentResult?.id || '';
  return id === 'bank_transfer' || /easypaisa|bank transfer/i.test(String(order.paymentMethod || ''));
}

function clientIpFromReq(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return (req.ip && String(req.ip)) || '';
}

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
    [
      {
        $set: {
          stock: { $add: ['$stock', qty] }
        }
      }
    ]
  );
}

async function userCanViewOrder(req, order) {
  if (String(order.user) === String(req.authUserId)) return true;
  const user = await User.findById(req.authUserId).select('role');
  return user?.role === 'admin';
}

/**
 * POST /api/orders/confirm — optional manual confirm after payment (same logic as webhook)
 */
router.post('/confirm', async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return fail(res, 503, 'Stripe is not configured');
    }

    const { paymentIntentId, shippingAddress, billingAddress } = req.body;
    if (!paymentIntentId || typeof paymentIntentId !== 'string') {
      return fail(res, 400, 'paymentIntentId is required');
    }

    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (pi.status !== 'succeeded') {
      return fail(res, 400, `Payment not completed (status: ${pi.status})`);
    }

    if (String(pi.metadata.userId) !== String(req.authUserId)) {
      return fail(res, 403, 'Payment does not belong to this account');
    }

    let result;
    try {
      result = await finalizeOrderFromPaymentIntent(pi, {
        shippingAddress:
          shippingAddress && typeof shippingAddress === 'object' ? shippingAddress : {},
        billingAddress:
          billingAddress && typeof billingAddress === 'object' ? billingAddress : undefined,
        clientIp: clientIpFromReq(req)
      });
    } catch (e) {
      if (e.code === 'EMPTY_CART') {
        return fail(res, 400, 'Cart is empty — cannot confirm order');
      }
      if (e.code === 'AMOUNT_MISMATCH') {
        return fail(
          res,
          409,
          'Cart total no longer matches payment. Please start checkout again.'
        );
      }
      if (e.code === 'STOCK') {
        return fail(res, 409, e.message);
      }
      if (e.code === 'FRAUD_REJECT') {
        return fail(res, 403, e.message || 'Order blocked for security reasons.');
      }
      if (e.code === 'CURRENCY' || e.code === 'BAD_METADATA' || e.code === 'NOT_SUCCEEDED') {
        return fail(res, 400, e.message);
      }
      throw e;
    }

    if (req.session) req.session.cart = [];

    notifyOrderPlaced(result, res, req);

    const status = result.duplicate ? 200 : 201;
    return ok(res, status, {
      message: result.duplicate
        ? 'Order already recorded'
        : 'Order placed successfully',
      data: { order: result.populated, duplicate: result.duplicate }
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const errors = Object.fromEntries(
        Object.values(error.errors || {}).map((e) => [e.path || 'field', e.message])
      );
      return fail(res, 400, 'Invalid order data', errors);
    }

    console.error('Confirm order error:', error);
    return fail(res, 500, error.message || 'Failed to confirm order');
  }
});

async function handleManualPlaceOrder(req, res) {
  const deliveryOption = ['standard', 'express', 'nextday'].includes(req.body.deliveryOption)
    ? req.body.deliveryOption
    : 'standard';
  const paymentMethod = String(req.body.paymentMethod || '').trim();
  const shippingAddress =
    req.body.shippingAddress && typeof req.body.shippingAddress === 'object'
      ? req.body.shippingAddress
      : {};

  if (!isAllowedManualPaymentMethod(paymentMethod)) {
    return fail(res, 400, 'Choose cash on delivery or bank transfer (Easypaisa)');
  }

  const transactionId =
    req.body.transactionId != null ? String(req.body.transactionId).trim().slice(0, 120) : '';

  const walletOpts = { useWallet: Boolean(req.body.useWallet) };
  if (paymentMethod === 'bank_transfer') {
    walletOpts.transactionId = transactionId;
  }

  let result;
  try {
    result = await finalizeOrderWithManualPayment(
      req.authUserId,
      deliveryOption,
      shippingAddress,
      paymentMethod,
      clientIpFromReq(req),
      walletOpts
    );
  } catch (e) {
    if (e.code === 'EMPTY_CART') {
      return fail(res, 400, 'Cart is empty');
    }
    if (e.code === 'NO_STOCK' || e.code === 'STOCK') {
      return fail(res, 409, e.message);
    }
    if (e.code === 'PRODUCT_GONE' || e.code === 'BAD_QTY' || e.code === 'BAD_PRICE') {
      return fail(res, 400, e.message);
    }
    if (e.code === 'INSUFFICIENT_WALLET') {
      return fail(res, 409, 'Insufficient wallet balance');
    }
    throw e;
  }

  if (req.session) req.session.cart = [];

  notifyOrderPlaced(result, res, req);

  return ok(res, 201, {
    message: 'Order placed successfully',
    data: {
      order: result.populated,
      paymentInstructions:
        paymentMethod === 'bank_transfer'
          ? { easypaisa: EASYPAISA_NUMBER, note: 'Send payment via Easypaisa to this number.' }
          : { note: 'Pay with cash when your order is delivered.' }
    }
  });
}

/**
 * POST /api/orders/place — COD or Easypaisa bank transfer (no Stripe)
 * POST /api/orders/create — alias for older clients
 */
async function placeOrderRoute(req, res) {
  try {
    return await handleManualPlaceOrder(req, res);
  } catch (error) {
    if (error.name === 'ValidationError') {
      const errors = Object.fromEntries(
        Object.values(error.errors || {}).map((e) => [e.path || 'field', e.message])
      );
      return fail(res, 400, 'Invalid order data', errors);
    }
    console.error('Place order error:', error);
    return fail(res, 500, error.message || 'Failed to place order');
  }
}

router.post('/place', placeOrderRoute);
router.post('/create', placeOrderRoute);

/**
 * POST /api/orders/:id/payment-proof — bank transfer screenshot + transaction ID
 */
router.post('/:id/payment-proof', proofUpload.single('proof'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return fail(res, 400, 'Invalid order id');
    }

    const order = await Order.findById(id);
    if (!order) {
      return fail(res, 404, 'Order not found');
    }

    if (String(order.user) !== String(req.authUserId)) {
      return fail(res, 403, 'Not allowed to update this order');
    }

    if (!isBankTransferOrder(order)) {
      return fail(res, 400, 'Payment proof only applies to bank transfer orders');
    }

    const txnId =
      req.body.transactionId != null
        ? String(req.body.transactionId).trim().slice(0, 120)
        : order.paymentProof?.transactionId || '';

    let imageUrl = order.paymentProof?.imageUrl || '';
    let imagePublicId = order.paymentProof?.imagePublicId || '';

    if (req.file) {
      if (!ensureConfigured()) {
        return fail(
          res,
          503,
          'Screenshot upload is not configured. Enter your transaction ID or contact support.'
        );
      }
      try {
        const uploaded = await uploadImageBuffer(req.file.buffer, {
          folder: 'nova-shop/payment-proofs'
        });
        imageUrl = uploaded.url;
        imagePublicId = uploaded.public_id;
      } catch (upErr) {
        console.error('Payment proof upload error:', upErr);
        return fail(res, 500, upErr.message || 'Could not upload screenshot');
      }
    }

    if (!txnId && !imageUrl) {
      return fail(res, 400, 'Enter a transaction ID or upload a payment screenshot');
    }

    order.paymentProof = {
      transactionId: txnId,
      imageUrl,
      imagePublicId,
      submittedAt: new Date()
    };

    const noteParts = [
      `Easypaisa: ${EASYPAISA_NUMBER}.`,
      txnId ? `Transaction ID: ${txnId}.` : '',
      imageUrl ? 'Payment screenshot on file.' : '',
      'Awaiting payment verification.'
    ].filter(Boolean);
    order.notes = noteParts.join(' ');

    await order.save();

    const populated = await Order.findById(order._id).populate(ORDER_POPULATE);

    return ok(res, 200, {
      message: 'Payment proof saved',
      data: { order: populated }
    });
  } catch (error) {
    if (error.message === 'Only image uploads are allowed') {
      return fail(res, 400, error.message);
    }
    console.error('Payment proof error:', error);
    return fail(res, 500, error.message || 'Failed to save payment proof');
  }
});

/**
 * GET /api/orders/my-orders — paginated list for current user
 */
router.get('/my-orders', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;

    const filter = { user: req.authUserId };
    const statusQ = req.query.status;
    const allowedStatus = [
      'pending',
      'processing',
      'shipped',
      'delivered',
      'cancelled',
      'flagged',
      'rejected'
    ];
    if (statusQ && allowedStatus.includes(String(statusQ))) {
      filter.status = String(statusQ);
    }

    const [orders, totalCount] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: 'orderItems.product',
          select: 'name slug images'
        })
        .lean(),
      Order.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(totalCount / limit) || 0;

    res.json({
      success: true,
      data: {
        orders,
        totalCount,
        totalPages,
        currentPage: page
      }
    });
  } catch (error) {
    console.error('My orders error:', error);
    fail(res, 500, error.message || 'Failed to fetch orders');
  }
});

/**
 * POST /api/orders/cancel/:id
 */
router.post('/cancel/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return fail(res, 400, 'Invalid order id');
    }

    const order = await Order.findById(id);
    if (!order) {
      return fail(res, 404, 'Order not found');
    }

    if (!(await userCanViewOrder(req, order))) {
      return fail(res, 403, 'Not allowed to cancel this order');
    }

    if (!['pending', 'processing', 'flagged'].includes(order.status)) {
      return fail(
        res,
        400,
        `Order cannot be cancelled in status: ${order.status}`
      );
    }

    const stripe = getStripe();
    const paidViaStripe =
      stripe && order.stripePaymentIntentId && order.isPaid && Number(order.walletAmountUsed || 0) === 0;

    if (paidViaStripe) {
      try {
        await stripe.refunds.create({
          payment_intent: order.stripePaymentIntentId
        });
      } catch (refundErr) {
        console.error('Stripe refund error:', refundErr);
        return fail(
          res,
          502,
          'Refund could not be processed. Order was not cancelled.',
          { orderId: String(order._id) }
        );
      }
    }

    for (const line of order.orderItems) {
      await incrementStockRollback(line.product, line.quantity);
    }

    order.status = 'cancelled';
    order.cancelReason =
      req.body.reason != null ? String(req.body.reason).slice(0, 1000) : '';
    await order.save();

    const refundTotal =
      round2(Number(order.walletAmountUsed) || 0) + round2(Number(order.totalPrice) || 0);
    if (refundTotal > 0) {
      try {
        await refundOrderToWallet(order.user, order, {
          amount: refundTotal,
          description: `Refund for cancelled order #${String(order._id).slice(-8).toUpperCase()} (added to Bazaar Wallet)`
        });
      } catch (walletErr) {
        console.error('Wallet refund on cancel failed:', walletErr);
      }
    }

    const user = await User.findById(req.authUserId).select('name email');
    if (user?.email) {
      try {
        await sendOrderCancelledEmail(user, order);
      } catch (mailErr) {
        console.error('Cancellation email failed:', mailErr);
      }
    }

    const populated = await Order.findById(order._id).populate(ORDER_POPULATE);

    return ok(res, 200, {
      message: 'Order cancelled',
      data: { order: populated }
    });
  } catch (error) {
    console.error('Cancel order error:', error);
    fail(res, 500, error.message || 'Failed to cancel order');
  }
});

/**
 * GET /api/orders/:id — single order (owner or admin)
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return fail(res, 400, 'Invalid order id');
    }

    if (['create', 'confirm', 'place', 'my-orders', 'cancel'].includes(id)) {
      return fail(res, 400, 'Invalid order id');
    }

    const order = await Order.findById(id).populate(ORDER_POPULATE);

    if (!order) {
      return fail(res, 404, 'Order not found');
    }

    if (!(await userCanViewOrder(req, order))) {
      return fail(res, 403, 'Not allowed to view this order');
    }

    hydratePaymentProof(order);

    res.json({ success: true, data: { order } });
  } catch (error) {
    if (error.name === 'CastError') {
      return fail(res, 400, 'Invalid order id');
    }
    console.error('Get order error:', error);
    fail(res, 500, error.message || 'Failed to fetch order');
  }
});

module.exports = router;
