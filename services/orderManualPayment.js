const crypto = require('crypto');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Cart = require('../models/Cart');
const Coupon = require('../models/Coupon');
const User = require('../models/User');
const { buildCheckoutSnapshot, buildGuestCheckoutSnapshot } = require('../utils/checkout');
const { EASYPAISA_NUMBER, PAYMENT_METHODS, isAllowedManualPaymentMethod } = require('../lib/paymentConfig');
const { ORDER_POPULATE } = require('./orderFromPaymentIntent');
const { resolveGuestCheckoutUser } = require('../lib/guestCheckoutUser');
const {
  getWalletBalance,
  computeWalletApplication,
  debitWallet
} = require('./walletService');

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
  let snapshot;
  try {
    snapshot = await buildCheckoutSnapshot(userId, deliveryOption);
  } catch (e) {
    if (e.code) throw e;
    throw e;
  }

  const useWallet = Boolean(paymentProofInput.useWallet);
  const walletBalance = await getWalletBalance(userId);
  const walletApply = computeWalletApplication(snapshot.totalPrice, walletBalance, useWallet);
  const walletAmountUsed = walletApply.walletAmountUsed;
  const orderTotal = walletApply.totalAfterWallet;

  if (orderTotal <= 0 && walletAmountUsed <= 0) {
    const err = new Error('Invalid order total');
    err.code = 'BAD_TOTAL';
    throw err;
  }

  if (orderTotal <= 0 && walletAmountUsed > 0) {
    paymentMethod = 'wallet';
  } else if (!isAllowedManualPaymentMethod(paymentMethod)) {
    const err = new Error('Invalid payment method');
    err.code = 'BAD_PAYMENT_METHOD';
    throw err;
  }

  const meta = PAYMENT_METHODS[paymentMethod] || PAYMENT_METHODS.cod;
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

  const notesBase =
    paymentMethod === 'bank_transfer'
      ? [
          `Easypaisa: ${EASYPAISA_NUMBER}.`,
          txnId ? `Transaction ID: ${txnId}.` : '',
          proofImageUrl ? 'Payment screenshot uploaded.' : '',
          'Awaiting payment verification.'
        ]
          .filter(Boolean)
          .join(' ')
      : paymentMethod === 'wallet'
        ? 'Paid in full with Bazaar Wallet.'
        : 'Cash on delivery — payment due when the order is delivered.';

  const notes =
    walletAmountUsed > 0 && paymentMethod !== 'wallet'
      ? `${notesBase} Rs ${walletAmountUsed} applied from Bazaar Wallet.`
      : notesBase;

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
        status: paymentMethod === 'wallet' ? 'succeeded' : 'pending',
        update_time: new Date().toISOString(),
        email_address: addr.email ?? ''
      },
      itemsPrice: snapshot.itemsPrice,
      taxPrice: snapshot.taxPrice,
      shippingPrice: snapshot.shippingPrice,
      totalPrice: orderTotal,
      walletAmountUsed,
      discountAmount: snapshot.discountAmount,
      coupon: snapshot.couponId || undefined,
      isPaid: paymentMethod === 'wallet',
      paidAt: paymentMethod === 'wallet' ? new Date() : null,
      status: paymentMethod === 'wallet' ? 'processing' : 'pending',
      notes,
      ...(paymentMethod === 'bank_transfer' ? { paymentProof } : {}),
      clientIp: clientIp ? String(clientIp).split(',')[0].trim() : ''
    });

    try {
      if (walletAmountUsed > 0) {
        await debitWallet(userId, walletAmountUsed, {
          reason: 'checkout',
          description: `Used on order #${String(order._id).slice(-8).toUpperCase()}`,
          orderId: order._id,
          referenceKey: `checkout:order:${order._id}`
        });
      }

      await Promise.all([
        snapshot.couponId
          ? Coupon.findByIdAndUpdate(snapshot.couponId, { $inc: { usedCount: 1 } })
          : Promise.resolve(),
        Cart.findOneAndUpdate(
          { user: userObjectId },
          { $set: { items: [], coupon: null, discountAmount: 0 } }
        )
      ]);
    } catch (afterErr) {
      await Order.deleteOne({ _id: order._id });
      for (const d of decremented.reverse()) {
        await incrementStockRollback(d.productId, d.qty);
      }
      if (snapshot.couponId) {
        await Coupon.findByIdAndUpdate(snapshot.couponId, { $inc: { usedCount: -1 } });
      }
      if (afterErr.code === 'INSUFFICIENT_WALLET') {
        const err = new Error('Insufficient wallet balance');
        err.code = 'INSUFFICIENT_WALLET';
        throw err;
      }
      throw afterErr;
    }

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

async function createManualOrderFromSnapshot(
  userId,
  snapshot,
  deliveryOption,
  shippingAddress,
  paymentMethod,
  clientIp,
  paymentProofInput,
  { clearServerCart = true } = {}
) {
  if (!isAllowedManualPaymentMethod(paymentMethod)) {
    const err = new Error('Invalid payment method');
    err.code = 'BAD_PAYMENT_METHOD';
    throw err;
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
      const afterOrderTasks = [];
      if (snapshot.couponId) {
        afterOrderTasks.push(
          Coupon.findByIdAndUpdate(snapshot.couponId, { $inc: { usedCount: 1 } })
        );
      }
      if (clearServerCart) {
        afterOrderTasks.push(
          Cart.findOneAndUpdate(
            { user: userObjectId },
            { $set: { items: [], coupon: null, discountAmount: 0 } }
          )
        );
      }
      if (afterOrderTasks.length) {
        await Promise.all(afterOrderTasks);
      }
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

/**
 * Guest checkout — items from browser cart, account created/linked by email.
 */
async function finalizeGuestOrderWithManualPayment(
  guestItems,
  deliveryOption,
  shippingAddress,
  paymentMethod,
  clientIp = '',
  paymentProofInput = {},
  couponCode = null
) {
  const userId = await resolveGuestCheckoutUser(shippingAddress);
  const snapshot = await buildGuestCheckoutSnapshot(guestItems, deliveryOption, couponCode);
  return createManualOrderFromSnapshot(
    userId,
    snapshot,
    deliveryOption,
    shippingAddress,
    paymentMethod,
    clientIp,
    paymentProofInput,
    { clearServerCart: false }
  );
}

module.exports = {
  finalizeOrderWithManualPayment,
  finalizeGuestOrderWithManualPayment,
  EASYPAISA_NUMBER
};
