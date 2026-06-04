/** One-off: deactivate categories with zero published products */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  const cats = await Category.find({}).lean();
  let off = 0;
  let on = 0;

  for (const cat of cats) {
    const count = await Product.countDocuments({
      category: cat._id,
      isPublished: true,
      approvalStatus: 'approved'
    });
    const shouldActive = count > 0;
    if (cat.isActive !== shouldActive) {
      await Category.updateOne({ _id: cat._id }, { $set: { isActive: shouldActive } });
    }
    if (shouldActive) {
      on += 1;
      console.log('ACTIVE', cat.slug, count);
    } else {
      off += 1;
      console.log('OFF   ', cat.slug);
    }
  }

  console.log('Done.', { active: on, inactive: off, total: cats.length });
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
