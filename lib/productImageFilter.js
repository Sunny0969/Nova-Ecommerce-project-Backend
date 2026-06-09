/** Storefront: product must have at least one non-placeholder image URL. */

function firstProductImageUrl(doc) {
  if (!doc) return '';
  const imgs = doc.images;
  if (Array.isArray(imgs) && imgs.length) {
    const u = imgs[0]?.url;
    if (u && String(u).trim()) return String(u).trim();
  }
  if (doc.imageUrl && String(doc.imageUrl).trim()) return String(doc.imageUrl).trim();
  return '';
}

function isValidProductImageUrl(url) {
  const u = String(url || '').trim();
  if (!u) return false;
  if (/placeholder/i.test(u)) return false;
  return true;
}

function productHasValidImage(doc) {
  return isValidProductImageUrl(firstProductImageUrl(doc));
}

/** MongoDB match: published listings with a real product image. */
function productHasImageMongoMatch() {
  return {
    images: {
      $elemMatch: {
        url: {
          $exists: true,
          $type: 'string',
          $nin: [''],
          $not: /placeholder/i
        }
      }
    }
  };
}

module.exports = {
  firstProductImageUrl,
  isValidProductImageUrl,
  productHasValidImage,
  productHasImageMongoMatch
};
