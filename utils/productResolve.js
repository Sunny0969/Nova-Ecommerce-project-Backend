const Product = require('../models/Product');

function isHexObjectId(value) {
  return typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value.trim());
}

/**
 * Resolves a Product by MongoDB _id (24-char hex) or by unique slug (legacy: productId).
 */
async function resolveProductByIdOrSlug(input) {
  if (input == null || input === '') return null;
  const s = String(input).trim();
  if (isHexObjectId(s)) {
    const byId = await Product.findById(s);
    if (byId) return byId;
  }
  return Product.findOne({ slug: s });
}

module.exports = {
  resolveProductByIdOrSlug,
  isHexObjectId
};
