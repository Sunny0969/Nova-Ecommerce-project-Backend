/**
 * Create or update an admin user in MongoDB.
 *
 * Run:
 *   node scripts/createAdminUser.js --email="you@example.com" --password="YourPass123" --name="Store Admin"
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const User = require('../models/User');

function argValue(prefix) {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (!hit) return null;
  const [, v] = hit.split('=');
  return v == null ? null : v;
}

async function main() {
  const email = String(argValue('--email=') || '')
    .trim()
    .toLowerCase();
  const password = argValue('--password=');
  const name = String(argValue('--name=') || 'Store Admin').trim();

  if (!email || !password) {
    console.error('Usage: node scripts/createAdminUser.js --email="admin@example.com" --password="secret" [--name="Admin Name"]');
    process.exit(1);
  }

  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI missing in backend/.env');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);

  let user = await User.findOne({ email }).select('+password');

  if (user) {
    user.name = name || user.name;
    user.password = password;
    user.role = 'admin';
    user.isActive = true;
    user.isVerified = true;
    await user.save();
    console.log(`Updated existing user to admin: ${email}`);
  } else {
    user = await User.create({
      name,
      email,
      password,
      role: 'admin',
      isActive: true,
      isVerified: true
    });
    console.log(`Created admin user: ${email}`);
  }

  console.log('You can sign in at /login (use ?next=/admin/dashboard for admin panel).');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
