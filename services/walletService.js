const mongoose = require('mongoose');
const User = require('../models/User');
const WalletTransaction = require('../models/WalletTransaction');
const { getStoreSettings } = require('./storeSettings');

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function formatTx(row) {
  if (!row) return null;
  const doc = typeof row.toObject === 'function' ? row.toObject() : row;
  return {
    _id: doc._id,
    type: doc.type,
    reason: doc.reason,
    amount: doc.amount,
    balanceAfter: doc.balanceAfter,
    description: doc.description || '',
    order: doc.order || null,
    createdAt: doc.createdAt
  };
}

async function getWalletBalance(userId) {
  const user = await User.findById(userId).select('walletBalance').lean();
  return round2(Number(user?.walletBalance) || 0);
}

async function applyWalletChange(userId, { direction, amount, reason, description, orderId, referenceKey, createdBy }) {
  const amt = round2(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    const err = new Error('Invalid wallet amount');
    err.code = 'BAD_AMOUNT';
    throw err;
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (referenceKey) {
      const dup = await WalletTransaction.findOne({ referenceKey }).session(session);
      if (dup) {
        await session.abortTransaction();
        session.endSession();
        const user = await User.findById(userId).select('walletBalance').lean();
        return {
          duplicate: true,
          balance: round2(Number(user?.walletBalance) || 0),
          transaction: formatTx(dup)
        };
      }
    }

    const user = await User.findById(userId).select('walletBalance').session(session);
    if (!user) {
      const err = new Error('User not found');
      err.code = 'USER_NOT_FOUND';
      throw err;
    }

    const current = round2(Number(user.walletBalance) || 0);
    let next = current;

    if (direction === 'credit') {
      next = round2(current + amt);
    } else {
      if (current < amt) {
        const err = new Error('Insufficient wallet balance');
        err.code = 'INSUFFICIENT_WALLET';
        throw err;
      }
      next = round2(current - amt);
    }

    user.walletBalance = next;
    await user.save({ session });

    const [tx] = await WalletTransaction.create(
      [
        {
          user: userId,
          type: direction,
          reason,
          amount: amt,
          balanceAfter: next,
          description: description || '',
          order: orderId || null,
          referenceKey: referenceKey || undefined,
          createdBy: createdBy || null
        }
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return {
      duplicate: false,
      balance: next,
      transaction: formatTx(tx)
    };
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    if (err.code === 11000 && referenceKey) {
      const user = await User.findById(userId).select('walletBalance').lean();
      const dup = await WalletTransaction.findOne({ referenceKey }).lean();
      return {
        duplicate: true,
        balance: round2(Number(user?.walletBalance) || 0),
        transaction: formatTx(dup)
      };
    }
    throw err;
  }
}

async function creditWallet(userId, amount, options = {}) {
  return applyWalletChange(userId, {
    direction: 'credit',
    amount,
    reason: options.reason || 'admin_adjustment',
    description: options.description || '',
    orderId: options.orderId,
    referenceKey: options.referenceKey,
    createdBy: options.createdBy
  });
}

async function debitWallet(userId, amount, options = {}) {
  return applyWalletChange(userId, {
    direction: 'debit',
    amount,
    reason: options.reason || 'checkout',
    description: options.description || '',
    orderId: options.orderId,
    referenceKey: options.referenceKey,
    createdBy: options.createdBy
  });
}

function computeWalletApplication(totalPrice, userBalance, useWallet, requestedAmount) {
  const total = round2(Math.max(0, Number(totalPrice) || 0));
  const balance = round2(Math.max(0, Number(userBalance) || 0));

  if (!useWallet || balance <= 0 || total <= 0) {
    return { walletAmountUsed: 0, totalAfterWallet: total, remainingBalance: balance };
  }

  const cap = requestedAmount != null ? round2(Math.min(requestedAmount, balance, total)) : round2(Math.min(balance, total));
  const walletAmountUsed = round2(Math.max(0, Math.min(cap, balance, total)));
  const totalAfterWallet = round2(Math.max(0, total - walletAmountUsed));

  return {
    walletAmountUsed,
    totalAfterWallet,
    remainingBalance: round2(balance - walletAmountUsed)
  };
}

async function refundOrderToWallet(userId, order, options = {}) {
  const walletUsed = round2(Number(order.walletAmountUsed) || 0);
  const total = round2(Number(order.totalPrice) || 0);
  const refundAmount = options.amount != null ? round2(options.amount) : total;

  if (refundAmount <= 0) {
    return { skipped: true, balance: await getWalletBalance(userId) };
  }

  const shortId = String(order._id).slice(-8).toUpperCase();
  return creditWallet(userId, refundAmount, {
    reason: 'order_cancel',
    description: options.description || `Refund for cancelled order #${shortId}`,
    orderId: order._id,
    referenceKey: `refund:order:${order._id}`,
    createdBy: options.createdBy
  });
}

async function creditCashbackForOrder(order) {
  if (order.cashbackCredited) {
    return { skipped: true, reason: 'already_credited' };
  }

  const settings = await getStoreSettings();
  if (settings.walletCashbackEnabled === false) {
    return { skipped: true, reason: 'disabled' };
  }

  const minOrder = round2(Number(settings.walletCashbackMinOrder) || 5000);
  const cashbackAmount = round2(Number(settings.walletCashbackAmount) || 500);
  const orderTotal = round2(Number(order.totalPrice) || 0);

  if (orderTotal < minOrder || cashbackAmount <= 0) {
    return { skipped: true, reason: 'below_threshold' };
  }

  const shortId = String(order._id).slice(-8).toUpperCase();
  const result = await creditWallet(order.user, cashbackAmount, {
    reason: 'cashback',
    description: `Cashback on order #${shortId} (${formatCashbackNote(minOrder, cashbackAmount)})`,
    orderId: order._id,
    referenceKey: `cashback:order:${order._id}`
  });

  if (!result.duplicate) {
    const Order = require('../models/Order');
    await Order.updateOne({ _id: order._id }, { $set: { cashbackCredited: true } });
  }

  return result;
}

function formatCashbackNote(minOrder, amount) {
  return `Rs ${amount} on orders over Rs ${minOrder}`;
}

async function listWalletTransactions(userId, { page = 1, limit = 20 } = {}) {
  const safeLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const skip = (safePage - 1) * safeLimit;

  const [rows, totalCount, balance] = await Promise.all([
    WalletTransaction.find({ user: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    WalletTransaction.countDocuments({ user: userId }),
    getWalletBalance(userId)
  ]);

  return {
    balance,
    transactions: rows.map(formatTx),
    totalCount,
    totalPages: Math.ceil(totalCount / safeLimit) || 0,
    currentPage: safePage
  };
}

async function getWalletSummary(userId) {
  const settings = await getStoreSettings();
  const balance = await getWalletBalance(userId);
  return {
    balance,
    cashbackOffer: {
      enabled: settings.walletCashbackEnabled !== false,
      minOrder: round2(Number(settings.walletCashbackMinOrder) || 5000),
      amount: round2(Number(settings.walletCashbackAmount) || 500)
    }
  };
}

module.exports = {
  getWalletBalance,
  creditWallet,
  debitWallet,
  computeWalletApplication,
  refundOrderToWallet,
  creditCashbackForOrder,
  listWalletTransactions,
  getWalletSummary,
  formatTx
};
