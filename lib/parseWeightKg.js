/**
 * Parse human-readable weight strings (e.g. "1.6 kg", "280 g") to kilograms.
 * @param {string|number|null|undefined} input
 * @returns {number|null}
 */
function parseWeightStringToKg(input) {
  if (input == null || input === '') return null;
  if (typeof input === 'number' && Number.isFinite(input) && input >= 0) return input;

  const raw = String(input).trim().toLowerCase();
  if (!raw) return null;

  const m = raw.match(/^([\d.,]+)\s*(kg|kgs|kilogram|kilograms|g|gram|grams|gm|lb|lbs|pound|pounds)?$/i);
  if (!m) {
    const numOnly = Number(raw.replace(/[^\d.]/g, ''));
    return Number.isFinite(numOnly) && numOnly >= 0 ? numOnly : null;
  }

  const value = Number(String(m[1]).replace(',', '.'));
  if (!Number.isFinite(value) || value < 0) return null;

  const unit = (m[2] || 'kg').toLowerCase();
  if (unit === 'g' || unit === 'gram' || unit === 'grams' || unit === 'gm') {
    return Math.round((value / 1000) * 10000) / 10000;
  }
  if (unit === 'lb' || unit === 'lbs' || unit === 'pound' || unit === 'pounds') {
    return Math.round(value * 0.453592 * 10000) / 10000;
  }
  return value;
}

module.exports = {
  parseWeightStringToKg
};
