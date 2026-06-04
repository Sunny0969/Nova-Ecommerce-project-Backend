/**
 * One-off: extract category SEO from saved HTML → categorySeoContent.js
 */
const fs = require('fs');
const path = require('path');

const DESKTOP = 'C:/Users/PC/Desktop';
const OUT = path.join(__dirname, '../../frontend/src/data/categorySeoContent.js');

const SLUG_MAP = {
  'Baby Care': 'baby-care',
  'Beverages': 'beverages',
  'Breakfast': 'breakfast',
  'Chicken & Meat': 'chicken-meat',
  'Cigarettes & Nicotine': 'cigarettes-nicotine',
  'Cleaning & Homecare': 'cleaning-homecare',
  'Dessert & Baking Essentials': 'dessert-baking-essentials',
  'Flour': 'flour',
  'Frozen': 'frozen',
  'Fruits & Vegetables': 'fruits-vegetables',
  'Hair Care': 'hair-care',
  'Jar & Canned Foods': 'jar-canned-foods',
  'Laundry': 'laundry',
  'Milk & Dairy': 'milk-dairy',
  'Oil & Ghee': 'oil-ghee',
  'Pasta & Noodles': 'pasta-noodles',
  'Personal Care': 'personal-care',
  'Pet Care': 'pet-care',
  'Pulses': 'pulses',
  'Rice': 'rice',
  'Snacks & Confectionary': 'snacks-confectionary',
  'Soaps & Handwashes': 'soaps-handwashes',
  'Spices & Sauces': 'spices-sauces',
  'Stationery & Party Supplies': 'stationery-party-supplies',
  'Sugar': 'sugar',
  'Tea & Coffee': 'tea-coffee',
  'Tissues': 'tissues'
};

function sanitize(text) {
  return String(text || '')
    .replace(/https?:\/\/(?:www\.)?bazaarapp\.com[^\s"']*/gi, '')
    .replace(/\bbazaar\s*app\b/gi, 'Rozana')
    .replace(/\bBazaarApp\b/g, 'Rozana')
    .replace(/\bBazaar\b/g, 'Rozana')
    .replace(/\bbazaar\.com\b/gi, '')
    .replace(/\bbazaar\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function spanText(html) {
  return sanitize(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<span[^>]*>/gi, '')
      .replace(/<\/span>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
  );
}

function extractFromFile(filePath, categoryLabel) {
  const html = fs.readFileSync(filePath, 'utf8');
  const slug = SLUG_MAP[categoryLabel];
  if (!slug) return null;

  let introTitle = `Shop ${categoryLabel} Online with Fast Delivery`;
  const introParagraphs = [];

  const shopH2 = html.match(/Shop [^<]{5,100} Online with the Convenience of Next Day Delivery/i);
  if (shopH2) introTitle = sanitize(shopH2[0]);

  const introBlock = html.match(
    /Shop [^<]{5,100} Online with the Convenience of Next Day Delivery[\s\S]{0,3500}?Why Shop with/i
  );
  if (introBlock) {
    const paras = introBlock[0].match(/<p>[\s\S]*?<\/p>/gi) || [];
    for (const p of paras) {
      const t = spanText(p);
      if (t.length > 50) introParagraphs.push(t);
    }
  }

  const whyTitle = `Why Shop with Rozana for ${categoryLabel}?`;
  const whyBullets = [];
  const whyBlock = html.match(/Why Shop with[\s\S]{0,4000}?<\/p>\s*<\/div>/i);
  if (whyBlock) {
    const p = whyBlock[0].match(/<p>[\s\S]*?<\/p>/i);
    if (p) {
      const lines = spanText(p[0])
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      for (const line of lines) {
        const m = line.match(/^([^:]+):\s*(.+)$/);
        if (m) whyBullets.push({ label: sanitize(m[1]), text: sanitize(m[2]) });
      }
    }
  }

  const faqs = [];
  const faqSchema = html.match(
    /<script id="text-block-faq-schema" type="application\/ld\+json">([\s\S]*?)<\/script>/
  );
  if (faqSchema) {
    try {
      const data = JSON.parse(faqSchema[1]);
      for (const q of data.mainEntity || []) {
        faqs.push({
          question: sanitize(q.name),
          answer: sanitize(q.acceptedAnswer?.text || '')
        });
      }
    } catch (_) {
      /* ignore */
    }
  }

  const priceList = [];
  const schemaM = html.match(/<script id="item-list-schema" type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (schemaM) {
    try {
      const data = JSON.parse(schemaM[1]);
      for (const el of (data.itemListElement || []).slice(0, 10)) {
        const p = el.item;
        if (!p?.name) continue;
        priceList.push({
          name: sanitize(String(p.name).replace(/\bBazaar\s+Select\b/gi, 'Select')),
          price: Number(p.offers?.price) || 0
        });
      }
    } catch (_) {
      /* ignore */
    }
  }

  const cleanFaqs = faqs.filter(
    (f) =>
      f.question &&
      f.answer &&
      f.answer.length > 20 &&
      !f.answer.includes('role=') &&
      !f.answer.includes('radix-')
  );

  return {
    slug,
    categoryLabel,
    introTitle,
    introParagraphs,
    whyTitle,
    whyBullets,
    faqs: cleanFaqs,
    priceList
  };
}

function genericFallback(slug, label) {
  return {
    slug,
    categoryLabel: label,
    introTitle: `Shop ${label} Online with Fast Delivery`,
    introParagraphs: [
      `Browse our ${label.toLowerCase()} range with everyday low prices and convenient delivery across Pakistan.`,
      `Filter by brand to find your favourites quickly.`
    ],
    whyTitle: `Why Shop with Rozana for ${label}?`,
    whyBullets: [
      { label: 'Certified & Original Products', text: 'Genuine products from trusted brands.' },
      { label: 'Daily Low Pricing', text: 'Affordable prices and great value packs.' },
      { label: 'Convenient Delivery', text: 'Reliable delivery to your doorstep.' },
      { label: 'Easy Ordering', text: 'A simple shopping experience from start to finish.' }
    ],
    faqs: [
      {
        question: `Where can I buy ${label} online in Pakistan?`,
        answer: `You can shop ${label} on Rozana and get delivery in Karachi, Lahore, Islamabad, and across Pakistan.`
      }
    ],
    priceList: []
  };
}

const LABEL_BY_SLUG = Object.fromEntries(
  Object.entries(SLUG_MAP).map(([label, slug]) => [slug, label])
);

function main() {
  const files = fs.readdirSync(DESKTOP).filter((f) => /^Buy .+ Online in Pakistan at Best Prices\.htm$/i.test(f));
  const out = {};

  for (const file of files) {
    const m = file.match(/^Buy (.+) Online in Pakistan at Best Prices\.htm$/i);
    if (!m) continue;
    const label = m[1].trim();
    try {
      const data = extractFromFile(path.join(DESKTOP, file), label);
      if (data) out[data.slug] = data;
      console.log('OK', label, '| intro:', data.introParagraphs.length, '| why:', data.whyBullets.length, '| faqs:', data.faqs.length);
    } catch (e) {
      console.warn('FAIL', file, e.message);
    }
  }

  for (const [slug, label] of Object.entries(LABEL_BY_SLUG)) {
    if (!out[slug]) out[slug] = genericFallback(slug, label);
  }

  const js = `/**
 * Category bottom SEO blocks (intro, why shop, FAQ, price list).
 * Bazaar references removed; shop name uses Rozana.
 */
export const CATEGORY_SEO_CONTENT = ${JSON.stringify(out, null, 2)};

export function getCategorySeoContent(slug) {
  if (!slug) return null;
  return CATEGORY_SEO_CONTENT[String(slug).toLowerCase()] || null;
}
`;

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, js, 'utf8');
  console.log('Wrote', OUT, Object.keys(out).length, 'categories');
}

main();
