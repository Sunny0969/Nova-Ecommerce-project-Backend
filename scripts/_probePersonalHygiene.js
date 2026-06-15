const fs = require('fs');
const path = require('path');

const files = [
  'C:/Users/PC/Downloads/a.htm',
  'C:/Users/PC/Downloads/aa.htm',
  'C:/Users/PC/Downloads/aaa.htm',
  'C:/Users/PC/Downloads/aaaa.htm',
  'C:/Users/PC/Downloads/aaaaa.htm'
];

function extractSection(html) {
  const m = html.match(/<span style="color: rgb\(2, 55, 136\);">([^<]+)<\/span><\/li><\/ol>/);
  return m ? m[1].replace(/&amp;/g, '&') : '';
}

function skuFromImage(url) {
  const s = String(url || '');
  const code = s.match(/\/([A-Z0-9]+)\./i);
  if (code) return code[1].toUpperCase();
  const dish = s.match(/\/dish_image\/(\d+)\./i);
  if (dish) return `DISH_${dish[1]}`;
  const base = path.basename(s).replace(/\.[a-z0-9]+$/i, '');
  if (/^\d+$/.test(base)) return `DISH_${base}`;
  return base ? base.toUpperCase() : '';
}

const all = [];
const seen = new Set();
for (const file of files) {
  if (!fs.existsSync(file)) {
    console.log('MISSING', file);
    continue;
  }
  const html = fs.readFileSync(file, 'utf8');
  const section = extractSection(html);
  let count = 0;
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const d = JSON.parse(m[1]);
      if (d['@type'] !== 'ItemList' || !d.itemListElement) continue;
      for (const el of d.itemListElement) {
        const p = el.item || el;
        const imageUrl = Array.isArray(p.image) ? p.image[0] : p.image || '';
        const sku = skuFromImage(imageUrl) || `ROW_${all.length + 1}`;
        if (seen.has(sku)) continue;
        seen.add(sku);
        count += 1;
        all.push({ file: path.basename(file), section, name: p.name, sku, price: Number(p.offers?.price) });
      }
    } catch {}
  }
  console.log(`${path.basename(file)} | ${section} | ${count} new`);
}
console.log('\nTotal unique:', all.length);
all.forEach((p, i) => console.log(`${i + 1}. [${p.section}] ${p.name} | ${p.sku} | Rs ${p.price}`));
