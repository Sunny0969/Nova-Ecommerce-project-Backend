/**
 * Admin customer APIs — `requireAdmin` on mount in server.js.
 */

const express = require('express');
const mongoose = require('mongoose');
const User = require('../../models/User');
const Order = require('../../models/Order');
const Cart = require('../../models/Cart');
const Wishlist = require('../../models/Wishlist');
const Review = require('../../models/Review');
const { ORDER_POPULATE } = require('../../services/orderFromPaymentIntent');
const { recalculateProductRatings } = require('../../utils/recalculateProductRatings');

const router = express.Router();

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

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * GET /api/admin/customers
 */
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const filter = { role: 'customer' };
    const q = String(req.query.search || req.query.q || '').trim();
    if (q) {
      filter.$or = [
        { name: { $regex: escapeRegex(q), $options: 'i' } },
        { email: { $regex: escapeRegex(q), $options: 'i' } }
      ];
    }

    const [customers, totalCount] = await Promise.all([
      User.find(filter)
        .select('-password -verificationToken -resetPasswordToken -resetPasswordExpire')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(totalCount / limit) || 0;

    return ok(res, 200, {
      data: {
        customers,
        totalCount,
        totalPages,
        currentPage: page
      }
    });
  } catch (error) {
    console.error('Admin list customers error:', error);
    return fail(res, 500, error.message || 'Failed to list customers');
  }
});

/**
 * PUT /api/admin/customers/:id/ban — toggle isActive (customers only)
 */
router.put('/:id/ban', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return fail(res, 400, 'Invalid user id');
    }

    const user = await User.findById(id);
    if (!user) {
      return fail(res, 404, 'Customer not found');
    }
    if (user.role !== 'customer') {
      return fail(res, 400, 'Only customer accounts can be banned via this action');
    }

    user.isActive = !user.isActive;
    await user.save();

    const safe = await User.findById(user._id)
      .select('-password -verificationToken -resetPasswordToken -resetPasswordExpire')
      .lean();

    return ok(res, 200, {
      message: user.isActive ? 'Customer unbanned' : 'Customer banned',
      data: { customer: safe }
    });
  } catch (error) {
    console.error('Admin ban customer error:', error);
    return fail(res, 500, error.message || 'Failed to update customer');
  }
});

/**
 * GET /api/admin/customers/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return fail(res, 400, 'Invalid user id');
    }

    const user = await User.findById(id)
      .select('-password -verificationToken -resetPasswordToken -resetPasswordExpire')
      .lean();

    if (!user || user.role !== 'customer') {
      return fail(res, 404, 'Customer not found');
    }

    const [orders, spentAgg] = await Promise.all([
      Order.find({ user: id })
        .sort({ createdAt: -1 })
        .populate(ORDER_POPULATE)
        .lean(),
      Order.aggregate([
        {
          $match: {
            user: new mongoose.Types.ObjectId(id),
            status: { $ne: 'cancelled' }
          }
        },
        { $group: { _id: null, totalSpent: { $sum: '$totalPrice' } } }
      ])
    ]);

    const totalSpent = spentAgg[0]?.totalSpent || 0;

    return ok(res, 200, {
      data: {
        customer: user,
        orders,
        totalSpent
      }
    });
  } catch (error) {
    if (error.name === 'CastError') {
      return fail(res, 400, 'Invalid user id');
    }
    console.error('Admin get customer error:', error);
    return fail(res, 500, error.message || 'Failed to load customer');
  }
});

/**
 * DELETE /api/admin/customers/:id — remove customer and related data
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return fail(res, 400, 'Invalid user id');
    }

    const user = await User.findById(id);
    if (!user) {
      return fail(res, 404, 'Customer not found');
    }
    if (user.role !== 'customer') {
      return fail(res, 400, 'Cannot delete admin accounts through this endpoint');
    }

    const reviewDocs = await Review.find({ user: id }).select('product').lean();
    const productIds = [
      ...new Set(reviewDocs.map((r) => String(r.product)))
    ];

    await Review.deleteMany({ user: id });
    await Cart.deleteOne({ user: id });
    await Wishlist.deleteOne({ user: id });
    await Order.deleteMany({ user: id });
    await User.deleteOne({ _id: id });

    await Promise.all(productIds.map((pid) => recalculateProductRatings(pid)));

    return ok(res, 200, {
      message: 'Customer and related data deleted',
      data: { deletedUserId: id }
    });
  } catch (error) {
    console.error('Admin delete customer error:', error);
    return fail(res, 500, error.message || 'Failed to delete customer');
  }
});

module.exports = router;
