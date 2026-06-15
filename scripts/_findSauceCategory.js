require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();
const mongoose = require('mongoose');
const Category = require('../models/Category');

mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS).then(async () => {
  const cats = await Category.find({ $or: [{ slug: /sauce/ }, { name: /Sauces/ }] }).select('name slug isActive');
  console.log(cats);
  await mongoose.disconnect();
});
