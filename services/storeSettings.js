const StoreSettings = require('../models/StoreSettings');

const DEFAULTS = {
  freeShippingMin: 50,
  shippingStandard: 4.99,
  shippingExpress: 5.99,
  shippingNextDay: 9.99,
  taxRate: 0
};

function normalizeDoc(doc) {
  if (!doc) return { ...DEFAULTS };
  return {
    freeShippingMin: Number(doc.freeShippingMin ?? DEFAULTS.freeShippingMin),
    shippingStandard: Number(doc.shippingStandard ?? DEFAULTS.shippingStandard),
    shippingExpress: Number(doc.shippingExpress ?? DEFAULTS.shippingExpress),
    shippingNextDay: Number(doc.shippingNextDay ?? DEFAULTS.shippingNextDay),
    taxRate: Math.min(1, Math.max(0, Number(doc.taxRate ?? DEFAULTS.taxRate)))
  };
}

/**
 * @returns {Promise<typeof DEFAULTS>}
 */
async function getStoreSettings() {
  let doc = await StoreSettings.findOne().lean();
  if (!doc) {
    await StoreSettings.create(DEFAULTS);
    doc = await StoreSettings.findOne().lean();
  }
  return normalizeDoc(doc);
}

/**
 * @param {Partial<typeof DEFAULTS>} patch
 */
async function updateStoreSettings(patch) {
  const current = await getStoreSettings();
  const next = {
    freeShippingMin:
      patch.freeShippingMin != null ? Math.max(0, Number(patch.freeShippingMin)) : current.freeShippingMin,
    shippingStandard:
      patch.shippingStandard != null ? Math.max(0, Number(patch.shippingStandard)) : current.shippingStandard,
    shippingExpress:
      patch.shippingExpress != null ? Math.max(0, Number(patch.shippingExpress)) : current.shippingExpress,
    shippingNextDay:
      patch.shippingNextDay != null ? Math.max(0, Number(patch.shippingNextDay)) : current.shippingNextDay,
    taxRate: patch.taxRate != null ? Math.min(1, Math.max(0, Number(patch.taxRate))) : current.taxRate
  };
  await StoreSettings.findOneAndUpdate({}, { $set: next }, { upsert: true });
  return getStoreSettings();
}

module.exports = {
  getStoreSettings,
  updateStoreSettings,
  DEFAULTS
};
