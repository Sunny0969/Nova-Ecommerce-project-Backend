const ADJUSTABLE_FIELDS = new Set(['price', 'comparePrice', 'costPrice', 'stock', 'weightKg']);

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * @param {number|null|undefined} current
 * @param {{ field: string, mode: 'percent'|'fixed', direction: 'increase'|'decrease', value: number }} adjustment
 */
function computeAdjustedValue(current, adjustment) {
  const { field, mode, direction } = adjustment;
  if (!ADJUSTABLE_FIELDS.has(field)) return null;

  const amount = Math.abs(Number(adjustment.value));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const base =
    current == null || current === '' || Number.isNaN(Number(current)) ? 0 : Number(current);
  const sign = direction === 'decrease' ? -1 : 1;

  let next;
  if (mode === 'percent') {
    next = base + base * ((sign * amount) / 100);
  } else {
    next = base + sign * amount;
  }

  if (field === 'stock') {
    return Math.max(0, Math.floor(next));
  }

  next = Math.max(0, roundMoney(next));

  if (field === 'comparePrice' || field === 'costPrice' || field === 'weightKg') {
    if (current == null && next === 0) return null;
  }

  return next;
}

function normalizeAdjustment(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const field = String(raw.field || '').trim();
  if (!ADJUSTABLE_FIELDS.has(field)) return null;

  const mode = String(raw.mode || 'percent').toLowerCase() === 'fixed' ? 'fixed' : 'percent';
  const direction =
    String(raw.direction || 'increase').toLowerCase() === 'decrease' ? 'decrease' : 'increase';
  const value = Number(raw.value);
  if (!Number.isFinite(value) || value <= 0) return null;

  if (mode === 'percent' && value > 1000) return null;

  return { field, mode, direction, value };
}

module.exports = {
  ADJUSTABLE_FIELDS,
  computeAdjustedValue,
  normalizeAdjustment
};
