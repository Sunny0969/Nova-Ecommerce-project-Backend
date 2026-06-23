function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/** @param {Array<{ minKg?: number, maxKg?: number, price?: number }>|null|undefined} raw */
function normalizeWeightShippingTiers(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => ({
      minKg: round2(Math.max(0, Number(t?.minKg) || 0)),
      maxKg: round2(Number(t?.maxKg)),
      price: round2(Math.max(0, Number(t?.price) || 0))
    }))
    .filter((t) => Number.isFinite(t.maxKg) && t.maxKg >= t.minKg && Number.isFinite(t.price))
    .sort((a, b) => a.minKg - b.minKg);
}

/** @param {ReturnType<typeof normalizeWeightShippingTiers>} tiers */
function validateWeightShippingTiers(tiers) {
  if (!tiers.length) return { ok: true, tiers: [] };

  for (let i = 0; i < tiers.length; i += 1) {
    const t = tiers[i];
    if (!Number.isFinite(t.minKg) || t.minKg < 0) {
      return { ok: false, message: `Weight tier ${i + 1}: invalid minimum (kg)` };
    }
    if (!Number.isFinite(t.maxKg) || t.maxKg < t.minKg) {
      return { ok: false, message: `Weight tier ${i + 1}: max kg must be ≥ min kg` };
    }
    if (!Number.isFinite(t.price) || t.price < 0) {
      return { ok: false, message: `Weight tier ${i + 1}: invalid price` };
    }
    if (i > 0 && t.minKg <= tiers[i - 1].maxKg) {
      return {
        ok: false,
        message: `Weight tier ${i + 1} overlaps tier ${i} (${tiers[i - 1].minKg}–${tiers[i - 1].maxKg} kg)`
      };
    }
  }

  return { ok: true, tiers };
}

/** @param {number} weightKg @param {Array<{ minKg: number, maxKg: number, price: number }>} tiers */
function findWeightShippingTier(weightKg, tiers) {
  const w = round2(Math.max(0, Number(weightKg) || 0));
  const list = normalizeWeightShippingTiers(tiers);
  if (!list.length) return null;

  for (const tier of list) {
    if (w >= tier.minKg && w <= tier.maxKg) return tier;
  }

  const last = list[list.length - 1];
  if (w > last.maxKg) return last;

  return null;
}

/** @returns {number|null} */
function resolveTierShippingPrice(weightKg, tiers) {
  const tier = findWeightShippingTier(weightKg, tiers);
  if (!tier) return null;
  return round2(tier.price);
}

function formatWeightTierRange(tier) {
  if (!tier) return '';
  return `${tier.minKg}–${tier.maxKg} kg`;
}

function hasWeightShippingTiers(settings) {
  return normalizeWeightShippingTiers(settings?.weightShippingTiers).length > 0;
}

module.exports = {
  normalizeWeightShippingTiers,
  validateWeightShippingTiers,
  findWeightShippingTier,
  resolveTierShippingPrice,
  formatWeightTierRange,
  hasWeightShippingTiers,
  round2
};
