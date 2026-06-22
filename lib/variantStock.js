/**
 * Per-option stock on variant axes (color / shape / size).
 */

const { AXES, sanitizeVariantAxes } = require('./variantAxes');

const AXIS_PRIORITY = ['size', 'shape', 'color'];

function parseOptionStock(option) {
  if (!option || option.stock == null || option.stock === '') return null;
  const n = Number(option.stock);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function axisHasOptionStock(axis) {
  if (!axis?.enabled || !Array.isArray(axis.options)) return false;
  return axis.options.some((o) => parseOptionStock(o) != null);
}

function hasPerOptionStock(variantAxes) {
  const axes = sanitizeVariantAxes(variantAxes || {});
  return AXES.some((key) => axisHasOptionStock(axes[key]));
}

/** Sum stock across all options that define stock (for catalog / product.stock sync). */
function sumAllOptionStock(variantAxes) {
  const axes = sanitizeVariantAxes(variantAxes || {});
  let sum = 0;
  let any = false;
  for (const key of AXES) {
    const ax = axes[key];
    if (!ax?.enabled) continue;
    for (const o of ax.options || []) {
      const s = parseOptionStock(o);
      if (s != null) {
        sum += s;
        any = true;
      }
    }
  }
  return any ? sum : null;
}

function computeCatalogStock(globalStock, variantAxes) {
  const variantSum = sumAllOptionStock(variantAxes);
  if (variantSum != null) return variantSum;
  const n = Number(globalStock);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/** When saving a product, keep product.stock aligned with variant totals when set. */
function applyVariantStockToProductStock(globalStock, variantAxes) {
  return computeCatalogStock(globalStock, variantAxes);
}

/**
 * Stock for the shopper's current variant selection.
 * Uses per-option stock on axes that define it; returns null to fall back to product-level stock.
 */
function resolveStockForPick(variantAxes, pick) {
  const axes = sanitizeVariantAxes(variantAxes || {});
  if (!pick || typeof pick !== 'object') return null;

  const stocks = [];
  for (const key of AXIS_PRIORITY) {
    const ax = axes[key];
    if (!ax?.enabled || !ax.options?.length) continue;
    if (!axisHasOptionStock(ax)) continue;

    const opts = ax.options.filter((o) => String(o?.label || '').trim());
    if (!opts.length) continue;

    const sel = pick[key];
    const idx = Array.isArray(sel) && sel.length ? Number(sel[0]) : 0;
    const safeIdx = Number.isFinite(idx) && idx >= 0 && idx < opts.length ? idx : 0;
    const opt = opts[safeIdx];
    const s = parseOptionStock(opt);
    stocks.push(s != null ? s : 0);
  }

  if (!stocks.length) return null;
  return Math.min(...stocks);
}

function parseOptionPrice(option) {
  if (!option || option.price == null || option.price === '') return null;
  const n = Number(option.price);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function parseOptionComparePrice(option) {
  if (!option || option.comparePrice == null || option.comparePrice === '') return null;
  const n = Number(option.comparePrice);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function axisHasOptionPrice(axis) {
  if (!axis?.enabled || !Array.isArray(axis.options)) return false;
  return axis.options.some((o) => parseOptionPrice(o) != null);
}

function hasPerOptionPrice(variantAxes) {
  const axes = sanitizeVariantAxes(variantAxes || {});
  return AXES.some((key) => axisHasOptionPrice(axes[key]));
}

/** Lowest variant price for shop cards / product.price sync ("from" price). */
function minAllOptionPrice(variantAxes) {
  const axes = sanitizeVariantAxes(variantAxes || {});
  let min = null;
  for (const key of AXES) {
    const ax = axes[key];
    if (!ax?.enabled) continue;
    for (const o of ax.options || []) {
      const p = parseOptionPrice(o);
      if (p == null) continue;
      if (min == null || p < min) min = p;
    }
  }
  return min;
}

function computeCatalogPrice(globalPrice, variantAxes) {
  const variantMin = minAllOptionPrice(variantAxes);
  if (variantMin != null) return variantMin;
  const n = Number(globalPrice);
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 100) / 100) : 0;
}

function applyVariantPriceToProductPrice(globalPrice, variantAxes) {
  return computeCatalogPrice(globalPrice, variantAxes);
}

/**
 * Selling price for the shopper's current variant selection.
 * Uses the highest-priority axis (size → shape → color) that defines per-option prices.
 */
function resolvePriceForPick(variantAxes, pick) {
  const axes = sanitizeVariantAxes(variantAxes || {});
  if (!pick || typeof pick !== 'object') return null;

  for (const key of AXIS_PRIORITY) {
    const ax = axes[key];
    if (!ax?.enabled || !ax.options?.length) continue;
    if (!axisHasOptionPrice(ax)) continue;

    const opts = ax.options.filter((o) => String(o?.label || '').trim());
    if (!opts.length) continue;

    const sel = pick[key];
    const idx = Array.isArray(sel) && sel.length ? Number(sel[0]) : 0;
    const safeIdx = Number.isFinite(idx) && idx >= 0 && idx < opts.length ? idx : 0;
    const p = parseOptionPrice(opts[safeIdx]);
    if (p != null) return p;
  }

  return null;
}

function resolveComparePriceForPick(variantAxes, pick) {
  const axes = sanitizeVariantAxes(variantAxes || {});
  if (!pick || typeof pick !== 'object') return null;

  for (const key of AXIS_PRIORITY) {
    const ax = axes[key];
    if (!ax?.enabled || !ax.options?.length) continue;
    if (!axisHasOptionPrice(ax)) continue;

    const opts = ax.options.filter((o) => String(o?.label || '').trim());
    if (!opts.length) continue;

    const sel = pick[key];
    const idx = Array.isArray(sel) && sel.length ? Number(sel[0]) : 0;
    const safeIdx = Number.isFinite(idx) && idx >= 0 && idx < opts.length ? idx : 0;
    const cp = parseOptionComparePrice(opts[safeIdx]);
    if (cp != null) return cp;
  }

  return null;
}

module.exports = {
  AXIS_PRIORITY,
  parseOptionStock,
  axisHasOptionStock,
  hasPerOptionStock,
  sumAllOptionStock,
  computeCatalogStock,
  applyVariantStockToProductStock,
  resolveStockForPick,
  parseOptionPrice,
  parseOptionComparePrice,
  axisHasOptionPrice,
  hasPerOptionPrice,
  minAllOptionPrice,
  computeCatalogPrice,
  applyVariantPriceToProductPrice,
  resolvePriceForPick,
  resolveComparePriceForPick
};
