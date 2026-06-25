/**
 * Map product stock / flags to schema.org Offer availability URLs.
 */
const SCHEMA_CONTEXT = 'https://schema.org';

const AVAILABILITY_URLS = {
  InStock: `${SCHEMA_CONTEXT}/InStock`,
  OutOfStock: `${SCHEMA_CONTEXT}/OutOfStock`,
  PreOrder: `${SCHEMA_CONTEXT}/PreOrder`,
  Discontinued: `${SCHEMA_CONTEXT}/Discontinued`
};

const VALID_STATUSES = Object.keys(AVAILABILITY_URLS);

function readStockQuantity(product, overrides = {}) {
  if (overrides.stockQuantity != null && Number.isFinite(Number(overrides.stockQuantity))) {
    return Number(overrides.stockQuantity);
  }
  const raw = product?.stockQuantity ?? product?.stock;
  const stock = Number(raw);
  return Number.isFinite(stock) ? stock : 0;
}

/**
 * @param {object} [product]
 * @param {{ inStock?: boolean, stockQuantity?: number }} [overrides]
 * @returns {'InStock'|'OutOfStock'|'PreOrder'|'Discontinued'}
 */
function resolveProductAvailabilityStatus(product = {}, overrides = {}) {
  const explicit = String(product?.availabilityStatus || '').trim();
  if (explicit && VALID_STATUSES.includes(explicit)) {
    return explicit;
  }

  if (product?.isPublished === false) {
    return 'Discontinued';
  }

  const stock = readStockQuantity(product, overrides);

  if (stock < 0) return 'PreOrder';
  if (overrides.inStock === false || stock === 0) return 'OutOfStock';
  if (overrides.inStock === true || stock > 0) return 'InStock';

  return stock > 0 ? 'InStock' : 'OutOfStock';
}

/**
 * @param {object} [product]
 * @param {{ inStock?: boolean, stockQuantity?: number }} [overrides]
 */
function resolveProductOfferAvailability(product = {}, overrides = {}) {
  const status = resolveProductAvailabilityStatus(product, overrides);
  return {
    status,
    url: AVAILABILITY_URLS[status],
    isAvailable: status === 'InStock' || status === 'PreOrder'
  };
}

module.exports = {
  SCHEMA_CONTEXT,
  AVAILABILITY_URLS,
  VALID_STATUSES,
  resolveProductAvailabilityStatus,
  resolveProductOfferAvailability
};
