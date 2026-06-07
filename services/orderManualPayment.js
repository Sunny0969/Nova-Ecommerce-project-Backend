const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Cart = require('../models/Cart');
const Coupon = require('../models/Coupon');
const User = require('../models/User');
const { buildCheckoutSnapshot } = require('../utils/checkout');
const { EASYPAISA_NUMBER, PAYMENT_METHODS, isAllowedManualPaymentMethod } = require('../lib/paymentConfig');
const { sendOrderConfirmationEmail, sendNewOrderAdminEmail } = require('../lib/email');
const { ORDER_POPULATE } = require('./orderFromPaymentIntent');

async function decrementStockAtomic(productId, qty) {
  return Product.findOneAndUpdate(
    { _id: productId, stock: { $gte: qty } },
    [{ $set: { stock: { $subtract: ['$stock', qty] } } }],
    { new: true }
  ).lean();
}

async function incrementStockRollback(productId, qty) {
  await Product.findOneAndUpdate(
    { _id: productId },
    [{ $set: { stock: { $add: ['$stock', qty] } } }]
  );
}

/**
 * Place order with COD or Easypaisa bank transfer (no Stripe).
 */
async function finalizeOrderWithManualPayment(
  userId,
  deliveryOption,
  shippingAddress,
  paymentMethod,
  clientIp = '',
  paymentProofInput = {}
) {
  if (!isAllowedManualPaymentMethod(paymentMethod)) {
    const err = new Error('Invalid payment method');
    err.code = 'BAD_PAYMENT_METHOD';
    throw err;
  }

  let snapshot;
  try {
    snapshot = await buildCheckoutSnapshot(userId, deliveryOption);
  } catch (e) {
    if (e.code) throw e;
    throw e;
  }

  const meta = PAYMENT_METHODS[paymentMethod];
  const addr =
    shippingAddress && typeof shippingAddress === 'object' ? shippingAddress : {};

  const txnId =
    paymentProofInput && paymentProofInput.transactionId
      ? String(paymentProofInput.transactionId).trim().slice(0, 120)
      : '';
  const proofImageUrl =
    paymentProofInput && paymentProofInput.imageUrl
      ? String(paymentProofInput.imageUrl).trim().slice(0, 2000)
      : '';
  const proofImagePublicId =
    paymentProofInput && paymentProofInput.imagePublicId
      ? String(paymentProofInput.imagePublicId).trim().slice(0, 200)
      : '';

  const notes =
    paymentMethod === 'bank_transfer'
      ? [
          `Easypaisa: ${EASYPAISA_NUMBER}.`,
          txnId ? `Transaction ID: ${txnId}.` : '',
          proofImageUrl ? 'Payment screenshot uploaded.' : '',
          'Awaiting payment verification.'
        ]
          .filter(Boolean)
          .join(' ')
      : 'Cash on delivery — payment due when the order is delivered.';

  const paymentProof =
    paymentMethod === 'bank_transfer'
      ? {
          transactionId: txnId,
          imageUrl: proofImageUrl,
          imagePublicId: proofImagePublicId,
          submittedAt: txnId || proofImageUrl ? new Date() : null
        }
      : undefined;

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
      paymentMethod: meta.paymentMethodLabel,
      paymentResult: {
        id: paymentMethod,
        status: 'pending',
        update_time: new Date().toISOString(),
        email_address: addr.email ?? ''
      },
      itemsPrice: snapshot.itemsPrice,
      taxPrice: snapshot.taxPrice,
      shippingPrice: snapshot.shippingPrice,
      totalPrice: snapshot.totalPrice,
      discountAmount: snapshot.discountAmount,
      coupon: snapshot.couponId || undefined,
      isPaid: false,
      paidAt: null,
      status: 'pending',
      notes,
      ...(paymentMethod === 'bank_transfer' ? { paymentProof } : {}),
      clientIp: clientIp ? String(clientIp).split(',')[0].trim() : ''
    });

    try {
      if (snapshot.couponId) {
        await Coupon.findByIdAndUpdate(snapshot.couponId, { $inc: { usedCount: 1 } });
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
        await Coupon.findByIdAndUpdate(snapshot.couponId, { $inc: { usedCount: -1 } });
      }
      throw afterErr;
    }

    const populated = await Order.findById(order._id).populate(ORDER_POPULATE);
    const user = await User.findById(userId).select('name email');
    try {
      await sendOrderConfirmationEmail(user || { name: addr.firstName || 'Customer' }, populated);
    } catch (mailErr) {
      console.error('Order confirmation email failed:', mailErr);
    }
    try {
      await sendNewOrderAdminEmail(populated, user);
    } catch (adminMailErr) {
      console.error('Admin new-order email failed:', adminMailErr);
    }

    return { order, populated, duplicate: false };
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

module.exports = { finalizeOrderWithManualPayment, EASYPAISA_NUMBER };
