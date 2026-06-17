/**
 * Re-assign milk-dairy products to subcategories by product title keywords.
 * Run: npm run assign:milk-dairy-subcategories
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const { assignCategorySubcategories } = require('../lib/assignCategorySubcategories');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  const result = await assignCategorySubcategories({ categorySlug: 'milk-dairy', publishedOnly: false });
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
