/**
 * Assign snacks products to subcategories.
 * Run: npm run assign:snacks-subcategories
 */
require('dotenv').config();
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();
const mongoose = require('mongoose');
const { assignCategorySubcategories } = require('../lib/assignCategorySubcategories');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  const result = await assignCategorySubcategories({
    categorySlug: 'snacks-confectionary',
    publishedOnly: true
  });
  console.log(`[${result.category}] Assigned/updated ${result.assigned} products`);
  if (result.skipped) console.warn(`${result.skipped} products could not be matched`);
  console.log('Counts by subcategory:');
  for (const [slug, n] of Object.entries(result.counts).sort()) {
    console.log(`  ${slug}: ${n}`);
  }
  console.log('Total:', result.total);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
