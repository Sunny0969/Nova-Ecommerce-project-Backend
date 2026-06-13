const { parseWeightStringToKg } = require('./parseWeightKg');

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function defaultProductWeightKg(settings) {
  const d = Number(settings?.defaultProductWeightKg);
  return Number.isFinite(d) && d > 0 ? d : 1;
}

function getExplicitProductWeightKg(product) {
  if (!product) return null;

  const direct = Number(product.weightKg);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const parsed = parseWeightStringToKg(product.weight);
  if (parsed != null && parsed > 0) return parsed;

  return null;
}

function productHasExplicitWeightKg(product) {
  return getExplicitProductWeightKg(product) != null;
}

function cartHasAnyMissingProductWeight(cartLines) {
  for (const line of cartLines || []) {
    const qty = Math.max(0, Number(line.quantity) || 0);
    if (!qty) continue;
    const p = line.product && typeof line.product === 'object' ? line.product : null;
    if (!productHasExplicitWeightKg(p)) return true;
  }
  return false;
}

function computeExplicitCartWeightKg(cartLines) {
  let total = 0;
  for (const line of cartLines || []) {
    const qty = Math.max(0, Number(line.quantity) || 0);
    if (!qty) continue;
    const p = line.product && typeof line.product === 'object' ? line.product : null;
    const w = getExplicitProductWeightKg(p);
    if (w != null) total += w * qty;
  }
  return Math.round(total * 1000) / 1000;
}

/**
 * Use flat standard shipping when any product lacks weight or total explicit weight is below threshold.
 */
function shouldUseFlatStandardShipping(cartLines, settings) {
  if (!cartLines || !cartLines.length) return true;
  if (cartHasAnyMissingProductWeight(cartLines)) return true;

  const threshold = Number(settings?.weightShippingThresholdKg);
  const t = Number.isFinite(threshold) && threshold > 0 ? threshold : 1;
  return computeExplicitCartWeightKg(cartLines) < t;
}

/**
 * Resolve standard delivery fee — weight-based unless fallback rules apply.
 */
function resolveStandardShippingPrice(cartLines, cartWeightKg, settings) {
  if (settings?.weightShippingEnabled === false) {
    return round2(Number(settings?.shippingStandard) ?? 299);
  }

  if (shouldUseFlatStandardShipping(cartLines, settings)) {
    return round2(Number(settings?.shippingStandard) ?? 299);
  }

  const w =
    cartWeightKg != null ? cartWeightKg : computeCartWeightKg(cartLines, settings);
  return calculateWeightBasedShipping(w, settings);
}

/**
 * Resolve shipping weight for one product (kg).
 * @param {{ weightKg?: number|null, weight?: string|null }|null|undefined} product
 * @param {object} [settings]
 */
function resolveProductWeightKg(product, settings) {
  if (!product) return defaultProductWeightKg(settings);

  const direct = Number(product.weightKg);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const parsed = parseWeightStringToKg(product.weight);
  if (parsed != null && parsed > 0) return parsed;

  return defaultProductWeightKg(settings);
}

/**
 * Sum cart line weights (product weight × quantity).
 * @param {Array<{ product?: object, quantity?: number }>} cartLines
 * @param {object} [settings]
 */
function computeCartWeightKg(cartLines, settings) {
  let total = 0;
  for (const line of cartLines || []) {
    const qty = Math.max(0, Number(line.quantity) || 0);
    if (!qty) continue;
    const p = line.product && typeof line.product === 'object' ? line.product : null;
    total += resolveProductWeightKg(p, settings) * qty;
  }
  return Math.round(total * 1000) / 1000;
}

/**
 * Weight-based standard shipping:
 * - up to threshold kg → base rate
 * - each started kg over threshold → + additional per kg
 */
function calculateWeightBasedShipping(totalWeightKg, settings) {
  const threshold = Number(settings?.weightShippingThresholdKg);
  const base = Number(settings?.shippingUpToThresholdKg);
  const extraPerKg = Number(settings?.shippingAdditionalPerKgOver);

  const t = Number.isFinite(threshold) && threshold > 0 ? threshold : 1;
  const baseRate = Number.isFinite(base) && base >= 0 ? base : 300;
  const addRate = Number.isFinite(extraPerKg) && extraPerKg >= 0 ? extraPerKg : 150;

  const w = Math.max(0, Number(totalWeightKg) || 0);
  if (w <= t) return round2(baseRate);

  const extraKg = w - t;
  const extraUnits = Math.ceil(extraKg - 1e-9);
  return round2(baseRate + extraUnits * addRate);
}

module.exports = {
  resolveProductWeightKg,
  computeCartWeightKg,
  calculateWeightBasedShipping,
  defaultProductWeightKg,
  getExplicitProductWeightKg,
  productHasExplicitWeightKg,
  cartHasAnyMissingProductWeight,
  computeExplicitCartWeightKg,
  shouldUseFlatStandardShipping,
  resolveStandardShippingPrice,
  round2
};
