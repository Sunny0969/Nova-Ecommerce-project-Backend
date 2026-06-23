const StoreSettings = require('../models/StoreSettings');
const { getOrSet, del, CACHE_KEYS } = require('../lib/apiCache');
const { invalidateStoreSettingsCache } = require('../lib/invalidatePublicCache');
const {
  normalizeWeightShippingTiers,
  validateWeightShippingTiers
} = require('../lib/weightShippingTiers');

const DEFAULTS = {
  freeShippingMin: 2026,
  shippingStandard: 299,
  shippingExpress: 499,
  shippingNextDay: 599,
  taxRate: 0,
  weightShippingEnabled: true,
  weightShippingThresholdKg: 1,
  shippingUpToThresholdKg: 300,
  shippingAdditionalPerKgOver: 150,
  defaultProductWeightKg: 1,
  weightShippingTiers: [],
  walletCashbackEnabled: true,
  walletCashbackMinOrder: 5000,
  walletCashbackAmount: 500
};

function normalizeDoc(doc) {
  if (!doc) return { ...DEFAULTS };

  const normalized = {
    freeShippingMin: Number(doc.freeShippingMin ?? DEFAULTS.freeShippingMin),
    shippingStandard: Number(doc.shippingStandard ?? DEFAULTS.shippingStandard),
    shippingExpress: Number(doc.shippingExpress ?? DEFAULTS.shippingExpress),
    shippingNextDay: Number(doc.shippingNextDay ?? DEFAULTS.shippingNextDay),
    taxRate: Math.min(1, Math.max(0, Number(doc.taxRate ?? DEFAULTS.taxRate))),
    weightShippingEnabled:
      doc.weightShippingEnabled !== undefined
        ? Boolean(doc.weightShippingEnabled)
        : DEFAULTS.weightShippingEnabled,
    weightShippingThresholdKg: Math.max(
      0.01,
      Number(doc.weightShippingThresholdKg ?? DEFAULTS.weightShippingThresholdKg)
    ),
    shippingUpToThresholdKg: Math.max(
      0,
      Number(doc.shippingUpToThresholdKg ?? DEFAULTS.shippingUpToThresholdKg)
    ),
    shippingAdditionalPerKgOver: Math.max(
      0,
      Number(doc.shippingAdditionalPerKgOver ?? DEFAULTS.shippingAdditionalPerKgOver)
    ),
    defaultProductWeightKg: Math.max(
      0.01,
      Number(doc.defaultProductWeightKg ?? DEFAULTS.defaultProductWeightKg)
    ),
    weightShippingTiers: normalizeWeightShippingTiers(doc.weightShippingTiers),
    walletCashbackEnabled:
      doc.walletCashbackEnabled !== undefined
        ? Boolean(doc.walletCashbackEnabled)
        : DEFAULTS.walletCashbackEnabled,
    walletCashbackMinOrder: Math.max(
      0,
      Number(doc.walletCashbackMinOrder ?? DEFAULTS.walletCashbackMinOrder)
    ),
    walletCashbackAmount: Math.max(
      0,
      Number(doc.walletCashbackAmount ?? DEFAULTS.walletCashbackAmount)
    )
  };

  if (doc.updatedAt) {
    normalized.updatedAt =
      doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : String(doc.updatedAt);
  }

  return normalized;
}

function patchNumber(patch, current, key, { min = 0, max = null } = {}) {
  if (patch[key] == null) return current[key];
  const n = Number(patch[key]);
  if (!Number.isFinite(n)) return current[key];
  let out = Math.max(min, n);
  if (max != null) out = Math.min(max, out);
  return out;
}



/**

 * @returns {Promise<typeof DEFAULTS>}

 */

async function getStoreSettings() {
  const { value } = await getOrSet(CACHE_KEYS.STORE_SETTINGS, async () => {
    let doc = await StoreSettings.findOne().lean();
    if (!doc) {
      await StoreSettings.create(DEFAULTS);
      doc = await StoreSettings.findOne().lean();
    }
    return normalizeDoc(doc);
  });
  return value;
}



/**

 * @param {Partial<typeof DEFAULTS>} patch

 */

async function updateStoreSettings(patch) {
  const current = await getStoreSettings();

  let tiers = current.weightShippingTiers;
  if (patch.weightShippingTiers != null) {
    const normalized = normalizeWeightShippingTiers(patch.weightShippingTiers);
    const validation = validateWeightShippingTiers(normalized);
    if (!validation.ok) {
      throw new Error(validation.message);
    }
    tiers = validation.tiers;
  }

  const next = {
    freeShippingMin: patchNumber(patch, current, 'freeShippingMin'),
    shippingStandard: patchNumber(patch, current, 'shippingStandard'),
    shippingExpress: patchNumber(patch, current, 'shippingExpress'),
    shippingNextDay: patchNumber(patch, current, 'shippingNextDay'),
    taxRate: patchNumber(patch, current, 'taxRate', { min: 0, max: 1 }),
    weightShippingEnabled:
      patch.weightShippingEnabled != null
        ? patch.weightShippingEnabled === true || patch.weightShippingEnabled === 'true'
        : current.weightShippingEnabled,
    weightShippingThresholdKg: patchNumber(patch, current, 'weightShippingThresholdKg', {
      min: 0.01
    }),
    shippingUpToThresholdKg: patchNumber(patch, current, 'shippingUpToThresholdKg'),
    shippingAdditionalPerKgOver: patchNumber(patch, current, 'shippingAdditionalPerKgOver'),
    defaultProductWeightKg: patchNumber(patch, current, 'defaultProductWeightKg', { min: 0.01 }),
    weightShippingTiers: tiers,
    walletCashbackEnabled:
      patch.walletCashbackEnabled != null
        ? patch.walletCashbackEnabled === true || patch.walletCashbackEnabled === 'true'
        : current.walletCashbackEnabled,
    walletCashbackMinOrder: patchNumber(patch, current, 'walletCashbackMinOrder'),
    walletCashbackAmount: patchNumber(patch, current, 'walletCashbackAmount')
  };

  await StoreSettings.findOneAndUpdate({}, { $set: next }, { upsert: true, new: true });
  invalidateStoreSettingsCache();
  del(CACHE_KEYS.STORE_SETTINGS);
  return getStoreSettings();
}



module.exports = {

  getStoreSettings,

  updateStoreSettings,

  DEFAULTS

};

