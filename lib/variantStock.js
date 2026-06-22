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

module.exports = {
  AXIS_PRIORITY,
  parseOptionStock,
  axisHasOptionStock,
  hasPerOptionStock,
  sumAllOptionStock,
  computeCatalogStock,
  applyVariantStockToProductStock,
  resolveStockForPick
};
