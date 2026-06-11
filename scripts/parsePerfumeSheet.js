/** Parse Google Sheets markdown export (imported perfumes). */
const fs = require('fs');
const path = require('path');
const { buildPerfumeShortDescription } = require('../lib/perfumeProductCopy');

const DEFAULT_SHEET = path.join(
  __dirname,
  '..',
  'seed-assets',
  'imported-perfumes',
  'sheet-export.md'
);

const BRAND_ALIASES = [
  ['Parfums de Marly', /parfums?\s*de\s*marly|demarly|demarily/i],
  ['Azzaro', /\bazzaro\b/i],
  ['Giorgio Armani', /\bgiorgio\s+armani\b|\bacqua\s+di\s+gio\b/i],
  ['Valentino', /\bvalentino\b|\bborn\s+in\s+roma\b/i],
  ['Dior', /\bdior\b|\bsauvage\b|\bmiss\s+dior\b|\bj'?adore\b/i],
  ['Chanel', /\bchanel\b|\bbleu\s+de\s+chanel\b|\ballure\b/i],
  ['Tom Ford', /\btom\s+ford\b|\boud\s+wood\b|\bblack\s+orchid\b/i],
  ['Creed', /\bcreed\b|\baventus\b/i],
  ['Yves Saint Laurent', /\byves\s+saint\s+laurent\b|\bYSL\b|\blibre\b/i],
  ['Versace', /\bversace\b|\beros\b|\bdylan\s+blue\b|\beros\b/i],
  ['Dolce & Gabbana', /\bdolce\s*(?:&|and)\s*gabbana\b|\blight\s+blue\b/i],
  ['Montblanc', /\bmont\s*blanc\b|\bexplorer\b/i],
  ['Burberry', /\bburberry\b|\bhero\b/i],
  ['Givenchy', /\bgivenchy\b|\bl\s*interdit\b/i],
  ['Hermès', /\bhermes\b|\bhermès\b|\bterre\b/i],
  ['Prada', /\bprada\b|\bluna\s+rossa\b/i],
  ['Gucci', /\bgucci\b|\bguilty\b|\bbloom\b/i],
  ['Jean Paul Gaultier', /\bjean\s+paul\s+gaultier\b|\ble\s+male\b|\bscandal\b/i],
  ['Carolina Herrera', /\bcarolina\s+herrera\b|\bgood\s+girl\b|\b212\b/i],
  ['Maison Francis Kurkdjian', /\bmaison\s+francis\b|\bMFK\b|\bbaccarat\b/i],
  ['Initio', /\binitio\b/i],
  ['Xerjoff', /\bxerjoff\b/i],
  ['Amouage', /\bamouage\b/i],
  ['Byredo', /\bbyredo\b/i],
  ['Le Labo', /\ble\s+labo\b|\bsantal\s+33\b/i],
  ['Armaf', /\barmaf\b|\bclub\s+de\s+nuit\b/i],
  ['Rasasi', /\brasasi\b/i],
  ['Lattafa', /\blattafa\b/i],
  ['Baccarat', /\bbaccarat\b|\b540\b/i],
  ['Maison Margiela', /\bmaison\s+margiela\b|\breplica\b/i],
  [' Viktor & Rolf', /\bviktor\s*(?:&|and)\s*rolf\b|\bflowerbomb\b/i],
  ['Paco Rabanne', /\bpaco\s+rabanne\b|\b1\s+million\b|\binvictus\b/i],
  ['Hugo Boss', /\bhugo\s+boss\b|\bbottled\b/i],
  ['Calvin Klein', /\bcalvin\s+klein\b|\bCK\s+One\b/i],
  ['Lancome', /\blanc[ôo]me\b|\bla\s+vie\s+est\s+belle\b/i],
  ['Estée Lauder', /\bestee\s+lauder\b|\bbeautiful\b/i]
];

function extractImageUrl(cell) {
  const s = String(cell || '');
  let m = s.match(/!\[\]\((https:\/\/docs\.google\.com[^)\s"]+)/);
  if (m) return m[1];
  m = s.match(/!\[\]\((https:\/\/docs\.google\.com[^)]+?)(?:\s+"[^"]*")?\)/);
  return m ? m[1].trim() : '';
}

function parseUsd(cell) {
  const m = String(cell || '').match(/\$\s*([0-9]+(?:\.[0-9]{1,2})?)/);
  return m ? Number(m[1]) : NaN;
}

function parseQuantity(qtyCell, statusCell) {
  const combined = `${qtyCell || ''} ${statusCell || ''}`.trim();
  if (/out\s*of\s*stock/i.test(combined)) return 0;
  const m = combined.match(/(\d+)\s*\+?/);
  if (m) return Math.min(999, parseInt(m[1], 10));
  if (/available/i.test(combined)) return 50;
  return 0;
}

function slugify(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeBrandLabel(raw) {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^demarly$/i, 'Parfums de Marly')
    .replace(/^demarily$/i, 'Parfums de Marly');
}

function canonicalBrand(label) {
  const key = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  const map = {
    azzaro: 'Azzaro',
    valentino: 'Valentino',
    'giorgio armani': 'Giorgio Armani',
    'parfums de marly': 'Parfums de Marly',
    demarly: 'Parfums de Marly',
    'perseus eau': 'Parfums de Marly'
  };
  if (map[key]) return map[key];
  if (key === key.toUpperCase() && key.length > 2) {
    return key
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  return String(label || '').trim();
}

function inferBrand(productName, familyCell) {
  const family = normalizeBrandLabel(familyCell);
  if (
    family &&
    family.length <= 48 &&
    !/usa perfum|ignite ecommerce|warehouse|stock|note\s*:/i.test(family)
  ) {
    return canonicalBrand(family);
  }

  const name = String(productName || '');
  for (const [label, rx] of BRAND_ALIASES) {
    if (rx.test(name)) return label.trim();
  }

  const lead = name.match(/^([A-Z][A-Za-z0-9&'.]+(?:\s+[A-Z][A-Za-z0-9&'.]+){0,3})/);
  if (lead && lead[1].length >= 3 && lead[1].length <= 40) {
    return canonicalBrand(lead[1].trim());
  }
  return 'Imported Perfume';
}

function buildTags(brand, name = '') {
  const slug = slugify(brand);
  const tags = new Set(['imported-perfume', 'perfume', 'authentic', slug]);
  if (brand) tags.add(brand);
  const n = String(name || '');
  if (/men|homme|for men|cologne|pour homme/i.test(n)) tags.add('men');
  if (/women|femme|for women|pour femme|lady|her\b/i.test(n)) tags.add('women');
  if (/unisex/i.test(n)) tags.add('unisex');
  return [...tags].filter(Boolean);
}

function buildDescription({
  name,
  brand,
  quantityLabel,
  status,
  warehouse,
  sku,
  sheetUsd,
  retailUsd,
  retailPkr
}) {
  return [
    `<h2>${name}</h2>`,
    `<p><strong>${brand}</strong> — premium imported fragrance, professionally listed on Bazaar PK.</p>`,
    '<ul>',
    `<li><strong>Brand / Family:</strong> ${brand}</li>`,
    `<li><strong>Availability:</strong> ${status || 'Available'}</li>`,
    `<li><strong>Stock quantity:</strong> ${quantityLabel || '—'}</li>`,
    sku ? `<li><strong>Reference SKU:</strong> ${sku}</li>` : '',
    '</ul>',
    '<p>100% genuine imported perfume — authentic designer scent, curated for Bazaar PK customers across Pakistan.</p>'
  ]
    .filter(Boolean)
    .join('\n');
}

function splitTableRow(line) {
  const parts = line.split('|').map((c) => c.trim());
  if (parts[0] === '') parts.shift();
  if (parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/** Detect image column — family may be before or absent when image is first data cell. */
function parseRowCells(line) {
  const parts = splitTableRow(line);
  if (parts.length < 6) return null;

  const rowNum = parseInt(parts[0], 10) || 0;
  const data = parts.slice(1);
  const imageIdx = data.findIndex((c) => extractImageUrl(c));
  if (imageIdx < 0) return null;

  const imageUrl = extractImageUrl(data[imageIdx]);
  let family = '';
  let name;
  let warehouse;
  let quantityRaw;
  let status;
  let priceCell;
  let sku;

  if (imageIdx === 0) {
    name = data[1] || '';
    warehouse = data[2] || '';
    quantityRaw = data[3] || '';
    status = data[4] || '';
    priceCell = data[5] || '';
    sku = data[8] || '';
  } else {
    family = data[0] || '';
    name = data[imageIdx + 1] || '';
    warehouse = data[imageIdx + 2] || '';
    quantityRaw = data[imageIdx + 3] || '';
    status = data[imageIdx + 4] || '';
    priceCell = data[imageIdx + 5] || '';
    sku = data[imageIdx + 8] || '';
  }

  return { rowNum, family, imageUrl, name, warehouse, quantityRaw, status, priceCell, sku };
}

function parsePerfumeSheetExport(filePath = DEFAULT_SHEET) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => /^\| [0-9]+/.test(l) && !l.includes('FAMILY'));

  const items = [];
  for (const line of lines) {
    const parsed = parseRowCells(line);
    if (!parsed) continue;

    const { rowNum, family, imageUrl, name, warehouse, quantityRaw, status, priceCell, sku } =
      parsed;
    if (!name || name.length < 6) continue;
    if (/usa perfum stock|ignite ecommerce/i.test(name)) continue;

    const sheetUsd = parseUsd(priceCell);
    if (!Number.isFinite(sheetUsd) || sheetUsd <= 0) continue;

    const brand = inferBrand(name, family);

    items.push({
      rowNum,
      brand,
      brandSlug: slugify(brand),
      name: name.replace(/\s+/g, ' ').trim().slice(0, 200),
      warehouse,
      quantityLabel: quantityRaw,
      status,
      stock: parseQuantity(quantityRaw, status),
      sheetUsd,
      imageUrl,
      sku: String(sku || '').trim(),
      tags: buildTags(brand, name)
    });
  }

  return items;
}

module.exports = {
  DEFAULT_SHEET,
  parsePerfumeSheetExport,
  parseUsd,
  parseQuantity,
  inferBrand,
  buildDescription,
  buildShortDescription: buildPerfumeShortDescription,
  buildTags,
  slugify,
  extractImageUrl
};
