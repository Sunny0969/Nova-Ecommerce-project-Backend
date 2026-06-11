const express = require('express');
const multer = require('multer');
const { finalizeGuestOrderWithManualPayment } = require('../services/orderManualPayment');
const { notifyOrderPlaced } = require('../lib/orderNotify');
const { uploadImageBuffer, ensureConfigured } = require('../lib/cloudinary');

const router = express.Router();

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

function ok(res, status, payload) {
  res.status(status).json({ success: true, ...payload });
}

function fail(res, status, message, errors) {
  const body = { success: false, message };
  if (errors && Object.keys(errors).length) body.errors = errors;
  res.status(status).json(body);
}

function clientIpFromReq(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return (req.ip && String(req.ip)) || '';
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
 * POST /api/orders/guest/place — checkout without login (COD / bank transfer)
 */
router.post('/place', proofUpload.single('proof'), async (req, res) => {
  try {
    const body = req.body || {};
    const deliveryOption = ['standard', 'express', 'nextday'].includes(body.deliveryOption)
      ? body.deliveryOption
      : 'standard';
    const paymentMethod = String(body.paymentMethod || '').trim();
    let shippingAddress = body.shippingAddress;
    let items = body.items;

    if (typeof shippingAddress === 'string') {
      try {
        shippingAddress = JSON.parse(shippingAddress);
      } catch {
        shippingAddress = {};
      }
    }
    if (typeof items === 'string') {
      try {
        items = JSON.parse(items);
      } catch {
        items = [];
      }
    }

    const guestItems = normalizeGuestItems(items);
    if (!guestItems.length) {
      return fail(res, 400, 'Cart is empty');
    }

    const transactionId =
      body.transactionId != null ? String(body.transactionId).trim().slice(0, 120) : '';

    let proofImageUrl = '';
    let proofImagePublicId = '';
    if (req.file?.buffer?.length) {
      ensureConfigured();
      const uploaded = await uploadImageBuffer(req.file.buffer, {
        folder: 'payment-proofs',
        resource_type: 'image'
      });
      proofImageUrl = uploaded.secure_url || uploaded.url || '';
      proofImagePublicId = uploaded.public_id || '';
    }

    const result = await finalizeGuestOrderWithManualPayment(
      guestItems,
      deliveryOption,
      shippingAddress && typeof shippingAddress === 'object' ? shippingAddress : {},
      paymentMethod,
      clientIpFromReq(req),
      { transactionId, imageUrl: proofImageUrl, imagePublicId: proofImagePublicId }
    );

    notifyOrderPlaced(result, res, req);

    return ok(res, 201, {
      message: 'Order placed successfully',
      data: { order: result.populated || result.order }
    });
  } catch (error) {
    if (error.code === 'EMPTY_CART') return fail(res, 400, 'Cart is empty');
    if (error.code === 'NO_STOCK') return fail(res, 409, error.message || 'Insufficient stock');
    if (error.code === 'PRODUCT_GONE') return fail(res, 409, error.message || 'Product unavailable');
    if (error.code === 'BAD_PAYMENT_METHOD') return fail(res, 400, 'Invalid payment method');
    if (error.code === 'BAD_EMAIL') return fail(res, 400, 'Valid email is required');
    console.error('Guest place order error:', error);
    return fail(res, 500, error.message || 'Failed to place order');
  }
});

module.exports = router;
