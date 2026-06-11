/** SEO copy helpers for imported perfume products (no admin/price boilerplate). */

function inferScentAudience(name) {
  const n = String(name || '');
  if (/unisex/i.test(n)) return 'Unisex designer fragrance';
  if (/men|homme|pour homme|cologne|for men/i.test(n)) return 'Designer fragrance for men';
  if (/women|femme|pour femme|for women|for her|lady/i.test(n)) return 'Designer fragrance for women';
  return 'Authentic designer fragrance';
}

function buildPerfumeShortDescription({ name, brand }) {
  const productName = String(name || '').trim();
  const brandName = String(brand || '').trim();
  const audience = inferScentAudience(productName);

  if (brandName) {
    return `${productName} — genuine ${brandName} imported perfume. ${audience} with fast delivery across Pakistan from Bazaar PK.`.slice(
      0,
      500
    );
  }

  return `${productName} — genuine imported designer perfume. ${audience} with fast delivery across Pakistan from Bazaar PK.`.slice(
    0,
    500
  );
}

function stripAdminEditorFooter(html) {
  return String(html || '')
    .replace(/<p>[^<]*Edit title,\s*price,\s*images[\s\S]*?<\/p>\s*/gi, '')
    .replace(/Edit title,\s*price,\s*images,\s*and description anytime from\s*Admin → Products\.?\s*/gi, '')
    .trim();
}

function hasAdminEditorFooter(text) {
  return /Edit title,\s*price,\s*images,\s*and description anytime from/i.test(String(text || ''));
}

function looksLikeImportedPerfumeShort(text) {
  return /imported perfume/i.test(String(text || ''));
}

function needsPerfumeShortRewrite(text) {
  const t = String(text || '');
  if (!looksLikeImportedPerfumeShort(t)) return false;
  return /Rs\.?\s*[\d,]+/i.test(t) || /\d+\+\s*\./i.test(t) || /—\s*\d+\+/.test(t);
}

function perfumeBrandFromShort(text) {
  const m = String(text || '').match(/^(.+?)\s+imported perfume/i);
  return m ? m[1].trim() : '';
}

function resolvePerfumeBrand(product, shortText = '') {
  const fromShort = perfumeBrandFromShort(shortText);
  if (fromShort) return fromShort;

  const tags = Array.isArray(product?.tags) ? product.tags : [];
  const skip = new Set(['perfume', 'imported-perfume', 'men', 'women', 'unisex']);
  const brandTag = tags.find((t) => t && !skip.has(String(t).toLowerCase()));
  if (brandTag) return String(brandTag).trim();

  return '';
}

function normalizeImportedPerfumeShort(product) {
  const raw = String(product?.shortDescription || '').trim();
  if (!looksLikeImportedPerfumeShort(raw) && !needsPerfumeShortRewrite(raw)) {
    return null;
  }
  if (!needsPerfumeShortRewrite(raw)) {
    return null;
  }

  const name = String(product?.name || '').trim();
  const brand = resolvePerfumeBrand(product, raw);
  return buildPerfumeShortDescription({ name, brand });
}

module.exports = {
  buildPerfumeShortDescription,
  stripAdminEditorFooter,
  hasAdminEditorFooter,
  looksLikeImportedPerfumeShort,
  needsPerfumeShortRewrite,
  normalizeImportedPerfumeShort,
  resolvePerfumeBrand
};
