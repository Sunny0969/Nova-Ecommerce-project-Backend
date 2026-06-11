/**
 * CLI: sync Product collection indexes (run after deploy or schema changes).
 * Usage: npm run db:ensure-indexes
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const { ensureProductIndexes } = require('../lib/ensureProductIndexes');

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI missing in backend/.env');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  const indexes = await ensureProductIndexes();
  console.log(`Synced ${indexes.length} indexes on products collection:`);
  for (const idx of indexes) {
    console.log(' -', idx.name);
  }
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
