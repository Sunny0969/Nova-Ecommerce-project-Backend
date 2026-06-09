const express = require('express');
const { getStoreSettings, updateStoreSettings } = require('../../services/storeSettings');

const router = express.Router();

function ok(res, data, message) {
  res.json({ success: true, message, data });
}

function fail(res, status, message) {
  res.status(status).json({ success: false, message });
}

/** GET /api/admin/store-settings */
router.get('/', async (req, res) => {
  try {
    const data = await getStoreSettings();
    ok(res, data, 'Store settings loaded');
  } catch (error) {
    console.error('admin store-settings GET:', error);
    fail(res, 500, error.message || 'Failed to load settings');
  }
});

/**
 * PUT /api/admin/store-settings
 * Body: { freeShippingMin, shippingStandard, shippingExpress, shippingNextDay, taxRate,
 *         weightShippingEnabled, weightShippingThresholdKg, shippingUpToThresholdKg,
 *         shippingAdditionalPerKgOver, defaultProductWeightKg }
 */
router.put('/', async (req, res) => {
  try {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const data = await updateStoreSettings({
      freeShippingMin: b.freeShippingMin,
      shippingStandard: b.shippingStandard,
      shippingExpress: b.shippingExpress,
      shippingNextDay: b.shippingNextDay,
      taxRate: b.taxRate,
      weightShippingEnabled: b.weightShippingEnabled,
      weightShippingThresholdKg: b.weightShippingThresholdKg,
      shippingUpToThresholdKg: b.shippingUpToThresholdKg,
      shippingAdditionalPerKgOver: b.shippingAdditionalPerKgOver,
      defaultProductWeightKg: b.defaultProductWeightKg
    });
    ok(res, data, 'Shipping and tax settings saved');
  } catch (error) {
    console.error('admin store-settings PUT:', error);
    fail(res, 500, error.message || 'Failed to save settings');
  }
});

module.exports = router;
