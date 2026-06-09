/**
 * Clean product descriptions corrupted by bulk imports (JSON metadata in description fields).
 */

const IMPORT_JSON_FIELD =
  /"(?:actualPrice|discountedPrice|retailPrice|imageUrl|imageId|brandId|inventoryWarehouseId|availableStock|uomSale|categorySlug|categoryName|slug|productId|storeId|warehouseId|mediaGallery|variantTitleSlug|inventoryStatus|cartonSize|tag|categoryFlag|isEnabled|productIds|handle|title)"\s*:/i;

function stripHtmlTags(html) {
  if (!html) return '';
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');
}

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\\+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function humanizeTitle(text) {
  const s = normalizeWhitespace(String(text || '').replace(/[-_]+/g, ' '));
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function looksLikeRawImportJson(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  if (s.startsWith('{') || s.startsWith('[')) return true;
  if (/^"actualPrice"\s*:/i.test(s)) return true;
  if (/^,\s*"actualPrice"\s*:/i.test(s)) return true;
  if (IMPORT_JSON_FIELD.test(s) && s.length > 40) {
    const withoutKeys = s.replace(/"[^"]+"\s*:/g, ' ').replace(/[{}\[\]",:0-9]/g, ' ');
    const wordy = (withoutKeys.match(/[a-zA-Z]{4,}/g) || []).join(' ').trim();
    if (wordy.length < 24) return true;
  }
  return (
    IMPORT_JSON_FIELD.test(s) &&
    (s.includes('"imageUrl"') ||
      s.includes('"mediaGallery"') ||
      s.includes('"brandId"') ||
      s.includes('"categoryFlag"') ||
      s.includes('"productIds"'))
  );
}

function looksLikeCorruptImport(text) {
  return looksLikeRawImportJson(text);
}

function looksLikeSafeAdminHtml(text) {
  const t = String(text || '').trim();
  if (!t.startsWith('<')) return false;
  return !looksLikeCorruptImport(t);
}

function parseJsonObject(text) {
  const t = String(text || '').trim();
  if (!t) return null;

  const attempts = [
    t,
    t.startsWith('{') || t.startsWith('[') ? null : `{${t.replace(/^,\s*/, '')}}`,
    t.startsWith('[') ? null : `[${t}]`
  ].filter(Boolean);

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* try next */
    }
  }
  return null;
}

function pickReadableFromObject(obj, fallbackName = '') {
  if (!obj || typeof obj !== 'object') return '';

  const candidates = [
    obj.description,
    obj.shortDescription,
    obj.longDescription,
    obj.productDescription,
    obj.title,
    obj.name,
    obj.variantTitleSlug
  ];

  for (const c of candidates) {
    const s = normalizeWhitespace(stripHtmlTags(String(c || '')));
    if (s && !looksLikeRawImportJson(s)) return s;
  }

  return humanizeTitle(fallbackName || obj.title || obj.name || '');
}

function extractDescriptionFromJsonValue(val, fallbackName = '') {
  if (Array.isArray(val)) {
    return val
      .map((item) => pickReadableFromObject(item, fallbackName))
      .filter(Boolean)
      .join('\n\n');
  }
  return pickReadableFromObject(val, fallbackName);
}

function tryParseEmbeddedJson(text, fallbackName = '') {
  const parsed = parseJsonObject(text);
  if (parsed != null) {
    const out = extractDescriptionFromJsonValue(parsed, fallbackName);
    if (out) return out;
  }

  const t = String(text || '').trim();
  const arrStart = t.search(/\[\s*\{/);
  if (arrStart >= 0) {
    try {
      const out = extractDescriptionFromJsonValue(JSON.parse(t.slice(arrStart)), fallbackName);
      if (out) return out;
    } catch {
      /* fall through */
    }
  }

  return null;
}

function stripImportJsonTail(text) {
  let s = String(text || '');
  if (looksLikeRawImportJson(s)) return '';

  s = s.replace(/\\+/g, ' ');

  const markers = [
    /,\s*"\s*,\s*"actualPrice"\s*:/i,
    /"\s*,\s*"actualPrice"\s*:/i,
    IMPORT_JSON_FIELD
  ];

  let cutAt = -1;
  for (const re of markers) {
    const m = s.match(re);
    if (m && m.index != null && m.index >= 0) {
      cutAt = cutAt === -1 ? m.index : Math.min(cutAt, m.index);
    }
  }
  if (cutAt >= 0) s = s.slice(0, cutAt);

  s = s.replace(/[\s,"']+$/, '').trim();
  s = normalizeWhitespace(s);
  if (looksLikeRawImportJson(s)) return '';
  return s;
}

function cleanProductDescriptionText(raw, fallbackName = '') {
  if (raw == null || raw === '') {
    return humanizeTitle(fallbackName);
  }

  const trimmed = String(raw).trim();
  if (looksLikeRawImportJson(trimmed)) {
    const fromJson = tryParseEmbeddedJson(trimmed, fallbackName);
    if (fromJson && !looksLikeRawImportJson(fromJson)) return fromJson.trim();
    return humanizeTitle(fallbackName);
  }

  const fromJson = tryParseEmbeddedJson(trimmed, fallbackName);
  if (fromJson && !looksLikeRawImportJson(fromJson)) return fromJson.trim();

  const plain = stripImportJsonTail(stripHtmlTags(trimmed));
  if (plain) return plain;
  return humanizeTitle(fallbackName);
}

function bothFieldsAreImportJson(product) {
  return (
    looksLikeRawImportJson(product?.shortDescription || '') &&
    looksLikeRawImportJson(product?.description || '')
  );
}

function extractSlugFromCorruptText(text) {
  const m = String(text || '').match(/"slug"\s*:\s*"([^"]+)"/i);
  return m ? String(m[1]).trim().toLowerCase() : '';
}

function extractTitleFromCorruptText(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';

  const beforeSlug = raw.match(/^(.+?)","\s*slug"\s*:/i);
  if (beforeSlug) {
    const head = normalizeWhitespace(beforeSlug[1]);
    if (head && !looksLikeRawImportJson(head)) return head;
  }

  const titleMatch = raw.match(/"title"\s*:\s*"([^"]+)"/i);
  if (titleMatch) {
    const t = normalizeWhitespace(titleMatch[1]);
    if (t && !looksLikeRawImportJson(t)) return t;
  }

  const stripped = stripImportJsonTail(stripHtmlTags(raw));
  if (stripped && !looksLikeCorruptProductName(stripped)) return stripped;

  return '';
}

function looksLikeCorruptProductName(name) {
  const s = String(name || '').trim();
  if (!s) return false;
  if (looksLikeRawImportJson(s)) return true;
  if (/categoryFlag|isEnabled|"handle":|"productIds":/i.test(s)) return true;
  if (/","slug":/i.test(s)) return true;
  if (s.length > 120) return true;
  return false;
}

function looksLikeCorruptProductSlug(slug) {
  const s = String(slug || '').trim().toLowerCase();
  if (!s) return true;
  if (s.length > 80) return true;
  if (/imageurl|categoryflag|productids|handleog|titleshampo/i.test(s)) return true;
  return false;
}

function slugifyProductTitle(text) {
  const s = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s.slice(0, 200);
}

function getCleanProductName(product) {
  const raw = String(product?.name || '').trim();
  if (!looksLikeCorruptProductName(raw)) return raw.slice(0, 200);

  const fromName = extractTitleFromCorruptText(raw);
  if (fromName) return fromName.slice(0, 200);

  const fromDesc = extractTitleFromCorruptText(
    product?.shortDescription || product?.description || ''
  );
  if (fromDesc) return fromDesc.slice(0, 200);

  const slugFromText = extractSlugFromCorruptText(raw) || extractSlugFromCorruptText(product?.slug);
  if (slugFromText) return humanizeTitle(slugFromText).slice(0, 200);

  const fromSlug = slugifyProductTitle(product?.slug);
  if (fromSlug) return humanizeTitle(fromSlug).slice(0, 200);

  return 'Product';
}

function getCleanProductSlug(product) {
  const raw = String(product?.slug || '').trim().toLowerCase();
  if (!looksLikeCorruptProductSlug(raw)) return raw;

  const fromText =
    extractSlugFromCorruptText(product?.name) || extractSlugFromCorruptText(product?.slug);
  if (fromText && !looksLikeCorruptProductSlug(fromText)) return fromText;

  const fromName = slugifyProductTitle(getCleanProductName(product));
  if (fromName && !looksLikeCorruptProductSlug(fromName)) return fromName;

  return raw.slice(0, 80) || 'product';
}

function getCleanShortDescription(product) {
  const name = getCleanProductName(product);
  if (bothFieldsAreImportJson(product)) return name;

  const fromShort = cleanProductDescriptionText(product?.shortDescription, name);
  if (fromShort && fromShort !== humanizeTitle(name)) return fromShort.slice(0, 500);

  const fromLong = cleanProductDescriptionText(product?.description, name);
  if (fromLong && fromLong !== humanizeTitle(name)) {
    return fromLong.length <= 500 ? fromLong : `${fromLong.slice(0, 497).trim()}…`;
  }

  if (fromShort) return fromShort;
  return name;
}

function getCleanLongDescription(product) {
  const name = getCleanProductName(product);
  if (bothFieldsAreImportJson(product)) {
    return name
      ? `${name}. Order online with secure checkout and delivery across Pakistan.`
      : '';
  }

  const fromLong = cleanProductDescriptionText(product?.description, name);
  if (fromLong && !looksLikeRawImportJson(fromLong) && fromLong !== humanizeTitle(name)) {
    return fromLong;
  }

  const fromShort = cleanProductDescriptionText(product?.shortDescription, name);
  if (fromShort && !looksLikeRawImportJson(fromShort) && fromShort !== humanizeTitle(name)) {
    return fromShort;
  }

  return name ? `${name}. Order online with secure checkout and delivery across Pakistan.` : '';
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDescriptionAsHtml(plainText) {
  const text = String(plainText || '').trim();
  if (!text || looksLikeRawImportJson(text)) return '';

  const blocks = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (!blocks.length) return `<p>${escapeHtml(text)}</p>`;
  return blocks.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
}

function resolveProductDescriptionHtml(product) {
  const raw = product?.description || '';
  if (looksLikeSafeAdminHtml(raw)) return raw;
  return formatDescriptionAsHtml(getCleanLongDescription(product));
}

function sanitizeProductDoc(product) {
  if (!product || typeof product !== 'object') {
    return { name: 'Product', shortDescription: '', description: '' };
  }

  const name = getCleanProductName(product);
  const short = getCleanShortDescription({ ...product, name });
  const safeShort = looksLikeRawImportJson(short) ? name : short;

  return {
    name,
    shortDescription: safeShort,
    description: resolveProductDescriptionHtml({ ...product, name })
  };
}

function needsDescriptionCleanup(product) {
  const rawName = product?.name || '';
  const rawSlug = product?.slug || '';
  if (looksLikeCorruptProductName(rawName) || looksLikeCorruptProductSlug(rawSlug)) return true;

  const rawShort = product?.shortDescription || '';
  const rawDesc = product?.description || '';
  if (looksLikeRawImportJson(rawShort) || looksLikeRawImportJson(rawDesc)) return true;

  const cleaned = sanitizeProductDoc(product);
  return (
    cleaned.name !== String(rawName).trim() ||
    cleaned.shortDescription !== String(rawShort).trim() ||
    cleaned.description !== String(rawDesc).trim()
  );
}

module.exports = {
  cleanProductDescriptionText,
  getCleanProductName,
  getCleanProductSlug,
  getCleanShortDescription,
  getCleanLongDescription,
  formatDescriptionAsHtml,
  resolveProductDescriptionHtml,
  sanitizeProductDoc,
  looksLikeCorruptImport,
  looksLikeCorruptProductName,
  looksLikeCorruptProductSlug,
  looksLikeRawImportJson,
  needsDescriptionCleanup
};
