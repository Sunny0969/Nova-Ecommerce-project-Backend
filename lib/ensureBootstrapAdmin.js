const User = require('../models/User');

/**
 * Ensures a single admin user exists when ADMIN_EMAIL + ADMIN_PASSWORD are set in .env.
 * Creates or updates role/password so the same customer login page can be used for admin.
 */
async function ensureBootstrapAdmin() {
  const email = String(process.env.ADMIN_EMAIL || '')
    .trim()
    .toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  const name = String(process.env.ADMIN_NAME || 'Store Admin').trim() || 'Store Admin';

  if (!email || !password) {
    console.log(
      '[Admin] Set ADMIN_EMAIL and ADMIN_PASSWORD in backend/.env to auto-create the admin user.'
    );
    return;
  }

  let user = await User.findOne({ email }).select('+password');

  if (!user) {
    user = new User({
      name,
      email,
      password,
      role: 'admin',
      isActive: true,
      isVerified: true,
      phone: ''
    });
    await user.save();
    console.log('[Admin] Bootstrap admin user created:', email);
    return;
  }

  user.name = name;
  user.role = 'admin';
  user.isActive = true;
  user.password = password;
  await user.save();
  console.log('[Admin] Bootstrap admin user updated:', email);
}

module.exports = { ensureBootstrapAdmin };
