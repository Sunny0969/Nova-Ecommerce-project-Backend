/**
 * A product is on sale when compare/original price is set and strictly greater than sale price.
 */
const { productHasImageMongoMatch } = require('./productImageFilter');

function saleProductMatchFilter() {
  return {
    isPublished: true,
    comparePrice: { $ne: null, $gt: 0 },
    price: { $gte: 0 },
    $expr: { $gt: ['$comparePrice', '$price'] },
    ...productHasImageMongoMatch()
  };
}

function discountPercentFromDoc(doc) {
  const compare = Number(doc?.comparePrice);
  const price = Number(doc?.price);
  if (!Number.isFinite(compare) || !Number.isFinite(price) || compare <= price || compare <= 0) {
    return 0;
  }
  return ((compare - price) / compare) * 100;
}

function isOnSaleDoc(doc) {
  return discountPercentFromDoc(doc) > 0;
}

module.exports = {
  saleProductMatchFilter,
  discountPercentFromDoc,
  isOnSaleDoc
};
