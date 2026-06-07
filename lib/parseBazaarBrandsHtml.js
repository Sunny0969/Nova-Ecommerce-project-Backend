const fs = require('fs');
const path = require('path');

const BAZAAR_BRANDS_API = 'https://www.bazaarapp.com/api/brands/all';

function readHtml(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`HTML file not found: ${resolved}`);
  }
  return fs.readFileSync(resolved, 'utf8');
}

/** Extract brand logo UUIDs from saved Bazaar /brands page HTML. */
function extractBrandImageIdsFromHtml(html) {
  const ids = new Set();
  const patterns = [
    /alt="brand-icon"[^>]*src="[^"]*\/([a-f0-9-]{36})\.avif"/gi,
    /src="[^"]*\/([a-f0-9-]{36})\.avif"[^>]*alt="brand-icon"/gi
  ];
  for (const re of patterns) {
    for (const m of html.matchAll(re)) {
      ids.add(m[1].toLowerCase());
    }
  }
  return [...ids];
}

function brandImageId(imageUrl) {
  const m = String(imageUrl || '').match(/\/([a-f0-9-]{36})\.(png|jpg|jpeg|webp|avif)/i);
  return m ? m[1].toLowerCase() : '';
}

async function fetchBazaarBrands() {
  const res = await fetch(BAZAAR_BRANDS_API, {
    headers: { Accept: 'application/json' }
  });
  if (!res.ok) {
    throw new Error(`Bazaar brands API failed (${res.status})`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error('Unexpected Bazaar brands API response');
  }
  return data;
}

/**
 * Parse brands from saved Bazaar HTML (logo UUIDs) and join with Bazaar API metadata.
 */
async function parseBazaarBrandsFromHtmlFile(filePath) {
  const html = readHtml(filePath);
  const imageIds = extractBrandImageIdsFromHtml(html);
  if (!imageIds.length) {
    throw new Error('No brand logos found in HTML file');
  }

  const apiBrands = await fetchBazaarBrands();
  const idSet = new Set(imageIds);
  const brands = apiBrands.filter((b) => idSet.has(brandImageId(b.imageUrl)));

  return { brands, imageIds: imageIds.length, matchedFromApi: brands.length };
}

module.exports = {
  BAZAAR_BRANDS_API,
  extractBrandImageIdsFromHtml,
  parseBazaarBrandsFromHtmlFile,
  brandImageId
};
