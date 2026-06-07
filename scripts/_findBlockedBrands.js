require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const BLOCKED_HASHES = new Set([
  '0e4e9150c9ee0343ffe07d536ec97297', // Bazaar Select logo (بازار wordmark)
  '79edca09ea40345c8a88b7e19967f0ea', // Bazaar Fresh
  'd9b4e17b2317535136fc9b02a14ce70f', // Bazaar Frozen
  '0d9258f999d9fbe4633e654f96aedf7f' // shared generic logo (Diamond/Easy On/Happy)
]);

const BLOCKED_NAME_RE = /^bazaar\b/i;
const BLOCKED_SLUGS = new Set(['bazaar-select', 'bazaar-fresh', 'bazaar-frozen']);

async function hashUrl(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return crypto.createHash('md5').update(buf).digest('hex');
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  const Brand = require('../models/Brand');

  const brands = await Brand.find({ isActive: true }).select('name slug image.url').lean();
  const toHide = [];

  for (const b of brands) {
    if (BLOCKED_NAME_RE.test(b.name) || BLOCKED_SLUGS.has(b.slug)) {
      toHide.push({ name: b.name, reason: 'bazaar-house-name' });
      continue;
    }
    const h = await hashUrl(b.image.url);
    if (h && BLOCKED_HASHES.has(h)) {
      toHide.push({ name: b.name, reason: 'blocked-logo-hash', hash: h });
    }
  }

  // Hide brands sharing the same logo image URL (generic duplicates)
  const byUrl = {};
  brands.forEach((b) => {
    const u = b.image?.url || '';
    if (!u) return;
    if (!byUrl[u]) byUrl[u] = [];
    byUrl[u].push(b);
  });
  for (const [url, group] of Object.entries(byUrl)) {
    if (group.length > 1) {
      group.slice(1).forEach((b) => {
        if (!toHide.find((x) => x.name === b.name)) {
          toHide.push({ name: b.name, reason: 'duplicate-logo-url' });
        }
      });
    }
  }

  console.log('to hide', toHide.length);
  toHide.forEach((x) => console.log('-', x.name, x.reason));

  process.exit(0);
})();
