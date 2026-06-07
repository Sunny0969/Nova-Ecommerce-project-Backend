/**
 * Hide Bazaar house brands and generic placeholder logos.
 * Run: npm run brands:hide-bazaar
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
const Brand = require('../models/Brand');
const { isBlockedBrand } = require('../lib/brandFilters');

configureMongoDns();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  const active = await Brand.find({ isActive: true }).lean();
  const blocked = active.filter(isBlockedBrand);

  if (blocked.length) {
    await Brand.updateMany(
      { _id: { $in: blocked.map((b) => b._id) } },
      { $set: { isActive: false, isPopular: false } }
    );
  }

  console.log(`[brands] Hidden ${blocked.length} generic/Bazaar placeholder brands`);
  blocked.forEach((b) => console.log(`  - ${b.name}`));

  const remaining = await Brand.countDocuments({ isActive: true });
  console.log(`[brands] ${remaining} brands still active`);
  process.exit(0);
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
