/**
 * Admin category list (includes inactive) — GET /api/admin/categories
 */

const express = require('express');
const mongoose = require('mongoose');
const Category = require('../../models/Category');
const Product = require('../../models/Product');

const router = express.Router();

function ok(res, data, status = 200) {
  res.status(status).json({ success: true, data });
}

/**
 * All categories with product counts.
 * If requested by staff, scopes only to categories created by this staff member.
 */
router.get('/', async (req, res) => {
  try {
    const productColl = Product.collection.name;
    const match = {};
    if (!req.adminUser && req.staff) {
      const staffScope = req.staff.permissions?.orderScope || 'all';
      if (staffScope === 'own_products') {
        match.createdByStaff = new mongoose.Types.ObjectId(req.staff.id);
      }
    }

    const rows = await Category.aggregate([
      ...(Object.keys(match).length ? [{ $match: match }] : []),
      { $sort: { displayOrder: 1, name: 1 } },
      {
        $lookup: {
          from: productColl,
          localField: '_id',
          foreignField: 'category',
          as: 'products'
        }
      },
      { $addFields: { productCount: { $size: '$products' } } },
      { $project: { products: 0 } }
    ]);
    ok(res, rows);
  } catch (err) {
    console.error('Admin list categories error:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to list categories' });
  }
});

module.exports = router;
