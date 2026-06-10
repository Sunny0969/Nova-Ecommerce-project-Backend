const Order = require('../models/Order');

/** Guest checkout creates a customer row with a random password — allow one-time activation. */
async function isActivatableGuestAccount(user) {
  if (!user || user.role !== 'customer') return false;
  if (user.createdViaGuestCheckout) return true;
  const name = String(user.name || '').trim();
  if (name === 'Guest customer') {
    const count = await Order.countDocuments({ user: user._id });
    return count > 0;
  }
  return false;
}

async function activateGuestAccount(user, { name, password, phone }) {
  user.name = String(name).trim();
  user.password = password;
  if (phone != null && String(phone).trim()) {
    user.phone = String(phone).trim();
  }
  user.createdViaGuestCheckout = false;
  await user.save();
  return user;
}

module.exports = { isActivatableGuestAccount, activateGuestAccount };
