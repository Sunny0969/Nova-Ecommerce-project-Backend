const express = require('express');
const { getStoreSettings } = require('../services/storeSettings');

const router = express.Router();

/** GET /api/store-settings — public (cart / guest pricing) */
router.get('/', async (req, res) => {
  try {
    const data = await getStoreSettings();
    res.json({ success: true, data });
  } catch (error) {
    console.error('store-settings GET error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to load store settings' });
  }
});

module.exports = router;
