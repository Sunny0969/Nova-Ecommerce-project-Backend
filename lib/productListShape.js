const { sanitizeProductDoc } = require('./productDescription');
const { sanitizeVariantAxes } = require('./variantAxes');
const { computeCatalogStock } = require('./variantStock');

/** Lean JSON for shop/home product cards — no description, variants, or reviews. */
function shapeProductListItem(doc) {
  const d =
    doc && typeof doc.toObject === 'function'
      ? doc.toObject({ virtuals: true })
      : doc;

  const first = Array.isArray(d.images) && d.images[0] ? d.images[0] : null;
  const firstImg = first?.url ? String(first.url) : '';

  let categorySlug =
    typeof d.category === 'object' && d.category?.slug ? d.category.slug : null;
  if (!categorySlug && typeof d.category === 'string') categorySlug = d.category;

  const stock = Number(d.stock);
  const variantAxes = sanitizeVariantAxes(d.variantAxes || {});
  const stockQuantity = computeCatalogStock(stock, variantAxes);
  const price = Number(d.price);
  const comparePrice = d.comparePrice != null ? Number(d.comparePrice) : undefined;

  const cleanedName = sanitizeProductDoc({
    name: d.name || '',
    shortDescription: '',
    description: '',
    slug: d.slug || ''
  }).name;

  return {
    _id: d._id,
    productId: d.slug,
    slug: d.slug,
    name: cleanedName,
    category: categorySlug || 'fashion',
    price: Number.isFinite(price) ? price : 0,
    comparePrice: Number.isFinite(comparePrice) ? comparePrice : undefined,
    originalPrice: Number.isFinite(comparePrice) ? comparePrice : undefined,
    isOnSale:
      Number.isFinite(comparePrice) &&
      Number.isFinite(price) &&
      comparePrice > price &&
      comparePrice > 0,
    emoji: '📦',
    imageUrl: firstImg,
    images: first ? [first] : [],
    stockQuantity,
    inStock: stockQuantity > 0,
    rating: Number.isFinite(Number(d.ratings)) ? Number(d.ratings) : 0,
    ratingCount: Number.isFinite(Number(d.numReviews)) ? Number(d.numReviews) : 0,
    badge: d.isFeatured ? 'bestseller' : '',
    isFeatured: Boolean(d.isFeatured),
    tags: Array.isArray(d.tags) ? d.tags : []
  };
}

module.exports = { shapeProductListItem };
