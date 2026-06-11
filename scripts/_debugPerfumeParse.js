const fs = require('fs');
const path = require('path');
const { DEFAULT_SHEET, parsePerfumeSheetExport } = require('./parsePerfumeSheet');

const text = fs.readFileSync(DEFAULT_SHEET, 'utf8');
const lines = text.split(/\r?\n/).filter((l) => /^\| [0-9]+/.test(l) && !l.includes('FAMILY'));

function extractImageUrl(cell) {
  const s = String(cell || '');
  let m = s.match(/!\[\]\((https:\/\/docs\.google\.com[^)\s"]+)/);
  if (m) return m[1];
  m = s.match(/!\[\]\((https:\/\/docs\.google\.com[^)]+?)(?:\s+"[^"]*")?\)/);
  return m ? m[1].trim() : '';
}

let noImg = 0;
let noPrice = 0;
let noName = 0;
const fails = [];

for (const line of lines) {
  const cols = line.split('|').slice(1, -1).map((c) => c.trim());
  let family = cols[1] || '';
  let imageCell = cols[2] || '';
  let name = cols[3] || '';
  let imageUrl = extractImageUrl(imageCell);
  if (!imageUrl && extractImageUrl(family)) {
    imageUrl = extractImageUrl(family);
    family = '';
  }
  if (!name || name.length < 6) {
    noName++;
    continue;
  }
  if (/usa perfum stock|ignite ecommerce/i.test(name)) {
    continue;
  }
  if (!imageUrl) {
    noImg++;
    if (fails.length < 5) fails.push({ row: cols[0], name: name.slice(0, 50), img: imageCell.slice(0, 100) });
    continue;
  }
  const price = String(cols[7] || '').match(/\$\s*([0-9.]+)/);
  if (!price) {
    noPrice++;
    continue;
  }
}

console.log('parsePerfumeSheetExport:', parsePerfumeSheetExport().length);
console.log({ total: lines.length, noImg, noPrice, noName, fails });
