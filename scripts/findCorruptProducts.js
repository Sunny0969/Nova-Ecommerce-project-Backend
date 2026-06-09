require('dotenv').config();
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();
const mongoose = require('mongoose');
const Product = require('../models/Product');

function looksCorrupt(doc) {
  const name = String(doc.name || '');
  const slug = String(doc.slug || '');
  if (/categoryFlag|"slug":|productIds|isEnabled/i.test(name)) return 'name_json';
  if (/imageurl|categoryflag|productids|handleog/i.test(slug)) return 'slug_garbage';
  if (name.length > 150) return 'name_long';
  if (slug.length > 80) return 'slug_long';
  return null;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  const all = await Product.find({}).select('name slug description shortDescription').lean();
  const bad = [];
  for (const p of all) {
    const reason = looksCorrupt(p);
    if (reason) bad.push({ ...p, reason });
  }
  console.log('total', all.length, 'corrupt', bad.length);
  bad.slice(0, 30).forEach((p) => {
    console.log(p.reason, '|', p.slug?.slice(0, 60), '|', String(p.name).slice(0, 80));
  });
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
