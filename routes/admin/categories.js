/**
 * Admin category list (includes inactive) — GET /api/admin/categories
 */

const express = require('express');
const Category = require('../../models/Category');
const Product = require('../../models/Product');

const router = express.Router();

function ok(res, data, status = 200) {
  res.status(status).json({ success: true, data });
}

/**
 * All categories with product counts (admin only).
 */
router.get('/', async (req, res) => {
  try {
    const productColl = Product.collection.name;
    const rows = await Category.aggregate([
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
