/** Bazaar house / generic placeholder logos — hide on storefront. */
const BLOCKED_SLUGS = new Set(['bazaar-select', 'bazaar-fresh', 'bazaar-frozen']);

const BLOCKED_NAME_RE = /^bazaar\b/i;

/** CDN image id fragments for generic Bazaar wordmark / shared placeholders. */
const BLOCKED_IMAGE_IDS = [
  '5a9f950c-aa79-4897-bdd8-16ffb583094d', // shared generic logo
  '2ebb3e00-80a7-48fc-9d7d-1539a6ade31b', // Easy On → generic logo
  'a9a0004e-3f54-4808-807b-375f7361b992', // Happy → generic logo
  '09a3e0dd-d5af-4181-9d08-82ba46dbce1b', // Bazaar Select
  '6fdccc5c-95e8-40ec-894a-e2dcc1202a2d', // Bazaar Fresh
  '8ffa44a9-d776-448f-b39e-55d99b6541e5' // Bazaar Frozen
];

function brandImageUrl(brand) {
  return String(brand?.image?.url || brand?.imageUrl || '').trim();
}

function isBlockedBrand(brand) {
  const slug = String(brand?.slug || '').toLowerCase();
  const name = String(brand?.name || '');
  const url = brandImageUrl(brand);

  if (BLOCKED_SLUGS.has(slug) || BLOCKED_NAME_RE.test(name)) return true;
  return BLOCKED_IMAGE_IDS.some((id) => url.includes(id));
}

function normalizeBrandText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** True when a published product name clearly belongs to this brand. */
function productMatchesBrand(productName, brandName) {
  const pn = normalizeBrandText(productName);
  const bn = normalizeBrandText(brandName);
  if (!bn || bn.length < 3) return false;
  if (pn === bn) return true;
  if (pn.startsWith(`${bn} `)) return true;
  if (pn.includes(` ${bn} `)) return true;
  if (pn.endsWith(` ${bn}`)) return true;
  return false;
}

/** MongoDB filter: product name matches brand (for GET /api/products?brand=slug). */
function productNameQueryForBrand(brandName) {
  const label = String(brandName || '').trim();
  if (!label) return null;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    $or: [
      { name: { $regex: `^${escaped}(\\s|$)`, $options: 'i' } },
      { name: { $regex: `(\\s|^)${escaped}(\\s|$)`, $options: 'i' } }
    ]
  };
}

module.exports = {
  BLOCKED_SLUGS,
  BLOCKED_NAME_RE,
  BLOCKED_IMAGE_IDS,
  brandImageUrl,
  isBlockedBrand,
  normalizeBrandText,
  productMatchesBrand,
  productNameQueryForBrand
};
