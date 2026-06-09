/**
 * Extract size / weight from Punjab Handicrafts product detail HTML.
 * Attribute IDs are stable on their storefront (size=4, weight=23).
 */
function extractProductSpecsFromHtml(html) {
  const pick = (attrId) => {
    const re = new RegExp(`name="attribute_id_${attrId}"[^>]*value="([^"]+)"`, 'g');
    const out = [];
    let m;
    while ((m = re.exec(html))) out.push(m[1].trim());
    return [...new Set(out)].join(', ');
  };
  return {
    size: pick(4),
    weight: pick(23)
  };
}

/** Older imports used alternate productId slugs — map to Punjab catalog slug. */
const PUNJAB_SLUG_ALIASES = {
  'blue-potter-vase': 'tiny-vase',
  'half-gamla-46': 'half-gamla-6',
  'dry-fruit-dish-ii': 'dry-fruit-dish-ii-1',
  'dry-fruit-dish-30': 'dry-fruit-dish-iii',
  'ash-tray': 'ash-tray0',
  'blue-pottery-dish': 'dish-4',
  'donga-ii': 'dunga-ii'
};

function resolvePunjabSlug(product) {
  const pid = String(product.productId || '').trim().toLowerCase();
  if (pid && PUNJAB_SLUG_ALIASES[pid]) return PUNJAB_SLUG_ALIASES[pid];
  if (pid) return pid;
  return String(product.slug || '').trim().toLowerCase();
}

async function fetchPunjabProductSpecs(slug) {
  const url = `https://handicrafts.punjab.gov.pk/product/${encodeURIComponent(slug)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  return extractProductSpecsFromHtml(html);
}

module.exports = {
  extractProductSpecsFromHtml,
  PUNJAB_SLUG_ALIASES,
  resolvePunjabSlug,
  fetchPunjabProductSpecs
};
