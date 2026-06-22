const User = require('../models/User');

function normalizeShippingAddress(addr = {}) {
  return {
    label: String(addr.label != null ? addr.label : 'Home')
      .trim()
      .slice(0, 80),
    firstName: String(addr.firstName || '').trim(),
    lastName: String(addr.lastName || '').trim(),
    email: String(addr.email || '').trim(),
    phone: String(addr.phone || '').trim(),
    street: String(addr.street || '').trim(),
    city: String(addr.city || '').trim(),
    state: String(addr.state || '').trim(),
    zipCode: String(addr.zipCode || '').trim(),
    country: String(addr.country || '').trim(),
    isDefault: Boolean(addr.isDefault)
  };
}

function hasRequiredAddressFields(addr) {
  const n = normalizeShippingAddress(addr);
  return Boolean(n.street && n.city && n.zipCode);
}

function addressIdentityKey(addr) {
  const n = normalizeShippingAddress(addr);
  return [n.street, n.city, n.zipCode, n.state]
    .map((s) => String(s).trim().toLowerCase())
    .join('|');
}

function syncSavedShippingFromDefault(user) {
  const def = (user.savedAddresses || []).find((a) => a.isDefault);
  if (!def) return;
  user.savedShippingAddress = {
    firstName: def.firstName,
    lastName: def.lastName,
    email: def.email,
    phone: def.phone,
    street: def.street,
    city: def.city,
    state: def.state,
    zipCode: def.zipCode,
    country: def.country
  };
}

function findMatchingAddress(savedAddresses, addr) {
  const key = addressIdentityKey(addr);
  return (savedAddresses || []).find((a) => addressIdentityKey(a) === key);
}

/**
 * Add or update a shipping address in the customer's saved address book.
 * Also keeps savedShippingAddress in sync with the default entry.
 */
async function upsertUserSavedAddress(userId, shippingAddress, { setAsDefault = true } = {}) {
  if (!userId || !hasRequiredAddressFields(shippingAddress)) {
    return { saved: false };
  }

  const user = await User.findById(userId);
  if (!user) return { saved: false };

  const doc = normalizeShippingAddress(shippingAddress);
  const list = user.savedAddresses || [];
  const match = findMatchingAddress(list, doc);

  if (match) {
    Object.assign(match, {
      firstName: doc.firstName,
      lastName: doc.lastName,
      email: doc.email,
      phone: doc.phone,
      street: doc.street,
      city: doc.city,
      state: doc.state,
      zipCode: doc.zipCode,
      country: doc.country
    });
    if (setAsDefault) {
      list.forEach((a) => {
        a.isDefault = false;
      });
      match.isDefault = true;
    }
  } else {
    if (list.length === 0 || setAsDefault) {
      list.forEach((a) => {
        a.isDefault = false;
      });
      doc.isDefault = true;
    } else {
      doc.isDefault = false;
    }
    user.savedAddresses.push(doc);
  }

  syncSavedShippingFromDefault(user);
  await user.save();

  const saved = match || user.savedAddresses[user.savedAddresses.length - 1];
  return {
    saved: true,
    address: typeof saved.toObject === 'function' ? saved.toObject() : saved
  };
}

async function persistShippingAddressAfterOrder(userId, shippingAddress) {
  try {
    await upsertUserSavedAddress(userId, shippingAddress, { setAsDefault: true });
  } catch (err) {
    console.error('[savedAddresses] After order:', err);
  }
}

async function migrateLegacyShippingAddress(userId) {
  const user = await User.findById(userId).select('savedAddresses savedShippingAddress');
  if (!user) return false;
  if (Array.isArray(user.savedAddresses) && user.savedAddresses.length > 0) return false;
  if (!user.savedShippingAddress || !hasRequiredAddressFields(user.savedShippingAddress)) {
    return false;
  }
  await upsertUserSavedAddress(userId, user.savedShippingAddress, { setAsDefault: true });
  return true;
}

module.exports = {
  normalizeShippingAddress,
  hasRequiredAddressFields,
  syncSavedShippingFromDefault,
  upsertUserSavedAddress,
  persistShippingAddressAfterOrder,
  migrateLegacyShippingAddress
};
