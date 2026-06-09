const crypto = require('crypto');
const User = require('../models/User');

async function resolveGuestCheckoutUser(shippingAddress) {
  const addr = shippingAddress && typeof shippingAddress === 'object' ? shippingAddress : {};
  const email = String(addr.email || '')
    .trim()
    .toLowerCase();
  if (!email) {
    const err = new Error('Email is required for guest checkout');
    err.code = 'BAD_EMAIL';
    throw err;
  }

  let user = await User.findOne({ email });
  if (user) return user._id;

  const name =
    `${String(addr.firstName || '').trim()} ${String(addr.lastName || '').trim()}`.trim() ||
    'Guest customer';
  const password = crypto.randomBytes(24).toString('base64url');

  user = await User.create({
    name,
    email,
    phone: String(addr.phone || '').trim(),
    password,
    role: 'customer'
  });
  return user._id;
}

module.exports = { resolveGuestCheckoutUser };
