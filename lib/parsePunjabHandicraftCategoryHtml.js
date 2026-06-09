const fs = require('fs');
const path = require('path');

const IMAGE_CDN = 'https://handicrafts.punjab.gov.pk/public/uploads/all/';

function readHtmlFile(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`HTML file not found: ${resolved}`);
  }
  return fs.readFileSync(resolved, 'utf8');
}

function metaContent(html, name) {
  const re = new RegExp(
    `<meta\\s+(?:name|property)=[\"']${name}[\"']\\s+content=[\"']([^\"']*)[\"']`,
    'i'
  );
  const m = html.match(re);
  return m ? m[1].trim() : '';
}

function slugifyCategoryName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function parsePrice(raw) {
  if (raw == null || raw === '') return 0;
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

function normalizeImageUrl(raw) {
  const u = String(raw || '').trim();
  if (!u || u.includes('placeholder.jpg')) return '';
  if (u.startsWith('http')) return u;
  if (u.startsWith('//')) return `https:${u}`;
  return `${IMAGE_CDN}${u.replace(/^\//, '')}`;
}

function extractProductCards(html) {
  const gridStart = html.indexOf('row-cols-xxl-4');
  const slice = gridStart >= 0 ? html.slice(gridStart) : html;
  const parts = slice.split(/<div class="col">\s*<div class="aiz-card-box/i);
  return parts.slice(1).map((chunk) => `<div class="aiz-card-box${chunk.split(/<div class="col">/)[0]}`);
}

function parseProductCard(card) {
  const linkMatch =
    card.match(
      /href="https?:\/\/handicrafts\.punjab\.gov\.pk\/product\/([^"]+)"[^>]*class="d-block text-reset"/i
    ) ||
    card.match(/href="https?:\/\/handicrafts\.punjab\.gov\.pk\/product\/([^"]+)"/i);
  if (!linkMatch) return null;

  const slug = linkMatch[1].trim().toLowerCase();
  const nameMatch =
    card.match(/class="d-block text-reset">([^<]+)<\/a>/i) ||
    card.match(/alt="([^"]+)"/i);
  const name = nameMatch ? nameMatch[1].trim() : slug;

  const priceBlock = card.match(/<div class="fs-15">[\s\S]*?<\/div>/i)?.[0] || card;
  const priceMatch = priceBlock.match(/>\s*Rs\.?\s*([\d,]+(?:\.\d{2})?)/i);
  const price = parsePrice(priceMatch?.[1]);

  const dataSrc = card.match(/data-src="([^"]*)"/i)?.[1];
  const src = card.match(/\ssrc="([^"]+)"/i)?.[1];
  const imageUrl = normalizeImageUrl(dataSrc || src || '');

  return {
    productId: slug,
    slug,
    name,
    price,
    imageUrl,
    images: imageUrl ? [{ url: imageUrl, public_id: '' }] : []
  };
}

function buildProductCopy(product, categoryName, categorySlug) {
  const tag = categorySlug || 'handicraft';
  const intro = `${product.name} belongs to our ${categoryName} collection at Bazaar.`;
  const body =
    'Each piece is handcrafted by skilled artisans with attention to detail. Ideal for display, gifting, or everyday use. Handle with care; wipe clean with a soft, dry cloth.';
  return {
    shortDescription: `${product.name} - handcrafted ${categoryName}, traditional artisan quality.`,
    description: `${intro}\n\n${body}\n\nCategory: ${categoryName} - Bazaar`,
    tags: [tag, 'handicraft', 'handmade', 'wooden-handicrafts']
  };
}

/**
 * @param {string} html
 * @param {{ categorySlug?: string, categoryName?: string }} [opts]
 */
function parsePunjabHandicraftCategoryHtml(html, opts = {}) {
  const title = metaContent(html, 'og:title') || metaContent(html, 'twitter:title') || '';
  const pageTitle = (html.match(/<title>([^<]+)<\/title>/i) || [])[1]?.trim() || title;
  const categoryName =
    opts.categoryName ||
    pageTitle.replace(/\s*-\s*.*/i, '').replace(/"/g, '').trim() ||
    'Handicrafts';
  const categorySlug = opts.categorySlug || slugifyCategoryName(categoryName);
  const description =
    metaContent(html, 'description') ||
    metaContent(html, 'og:description') ||
    `Shop authentic ${categoryName} online at Bazaar.`;

  const ogImage = normalizeImageUrl(metaContent(html, 'og:image') || metaContent(html, 'itemprop:image'));

  const products = [];
  const seen = new Set();
  for (const card of extractProductCards(html)) {
    const p = parseProductCard(card);
    if (!p || !p.name || seen.has(p.productId)) continue;
    seen.add(p.productId);
    const copy = buildProductCopy(p, categoryName, categorySlug);
    products.push({ ...p, ...copy });
  }

  return {
    category: {
      name: categoryName,
      slug: categorySlug,
      description,
      image: ogImage ? { url: ogImage, public_id: '' } : { url: '', public_id: '' }
    },
    products
  };
}

function parsePunjabHandicraftCategoryHtmlFile(filePath, opts = {}) {
  const html = readHtmlFile(filePath);
  return parsePunjabHandicraftCategoryHtml(html, opts);
}

async function fetchPunjabHandicraftCategoryHtml(categorySlug) {
  const url = `https://handicrafts.punjab.gov.pk/category/${encodeURIComponent(categorySlug)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch category page (${res.status})`);
  return res.text();
}

async function fetchProductOgImage(productSlug) {
  try {
    const res = await fetch(
      `https://handicrafts.punjab.gov.pk/product/${encodeURIComponent(productSlug)}`
    );
    if (!res.ok) return '';
    const html = await res.text();
    return normalizeImageUrl(metaContent(html, 'og:image') || metaContent(html, 'itemprop:image'));
  } catch {
    return '';
  }
}

module.exports = {
  parsePunjabHandicraftCategoryHtml,
  parsePunjabHandicraftCategoryHtmlFile,
  fetchPunjabHandicraftCategoryHtml,
  fetchProductOgImage,
  normalizeImageUrl
};
