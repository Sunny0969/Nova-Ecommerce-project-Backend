const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const router = express.Router();
const User = require('../models/User');
const Review = require('../models/Review');
const { mergeSessionCartIntoUserCart } = require('../utils/cartSync');
const { signToken, verifyToken, requireJwtAuth } = require('../middleware/jwtAuth');
const { uploadImageBuffer } = require('../lib/cloudinary');

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      cb(new Error('Only image uploads are allowed'));
      return;
    }
    cb(null, true);
  }
});

function userPayload(user) {
  return {
    id: user._id,
    email: user.email,
    name: user.name,
    role: user.role,
    phone: user.phone || '',
    avatar: user.avatar || ''
  };
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function normalizeAddressInput(b = {}) {
  return {
    label: String(b.label != null ? b.label : 'Home')
      .trim()
      .slice(0, 80),
    firstName: String(b.firstName || '').trim(),
    lastName: String(b.lastName || '').trim(),
    email: String(b.email || '').trim(),
    phone: String(b.phone || '').trim(),
    street: String(b.street || '').trim(),
    city: String(b.city || '').trim(),
    state: String(b.state || '').trim(),
    zipCode: String(b.zipCode || '').trim(),
    country: String(b.country || '').trim(),
    isDefault: Boolean(b.isDefault)
  };
}

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

/** Customer registration must not use the bootstrap admin email (admin is never a customer account). */
function isReservedAdminEmail(email) {
  const reserved = normalizeEmail(process.env.ADMIN_EMAIL || '');
  if (!reserved) return false;
  return normalizeEmail(email) === reserved;
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

// Register new user (password hashed in User model pre-save with bcrypt)
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Name is required'
      });
    }

    const emailNorm = normalizeEmail(email);
    const existingUser = await User.findOne({ email: emailNorm });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    if (isReservedAdminEmail(emailNorm)) {
      return res.status(403).json({
        success: false,
        code: 'RESERVED_ADMIN_EMAIL',
        message:
          'This email is reserved for the store administrator. Use a different email for a customer account, or sign in on the Login tab with your admin password.'
      });
    }

    const user = new User({
      name: String(name).trim(),
      email: emailNorm,
      password,
      phone: phone != null ? String(phone).trim() : ''
    });

    await user.save();

    const guestCart = req.session.cart ? [...req.session.cart] : [];
    if (guestCart.length > 0) {
      await mergeSessionCartIntoUserCart(user._id, guestCart);
      req.session.cart = [];
    }

    const token = signToken(user);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: userPayload(user)
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: error.message
    });
  }
});

// Login — returns JWT (password verified with bcrypt in User.comparePassword)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const emailNorm = normalizeEmail(email);

    const user = await User.findOne({ email: emailNorm }).select('+password');
    if (!user) {
      return res.status(404).json({
        success: false,
        code: 'USER_NOT_FOUND',
        message:
          'No account exists for this email. Please register first, then sign in. (Administrator accounts use the same login once they exist in the database.)'
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_PASSWORD',
        message: 'Incorrect password. Please try again.'
      });
    }

    if (user.role === 'customer' && user.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'Account suspended'
      });
    }

    const guestCart = req.session.cart ? [...req.session.cart] : [];
    if (guestCart.length > 0) {
      await mergeSessionCartIntoUserCart(user._id, guestCart);
      req.session.cart = [];
    }

    const token = signToken(user);

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: userPayload(user)
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
});

// Logout — JWT is stateless; client discards token. Session kept for guest cart.
router.post('/logout', (req, res) => {
  res.json({
    success: true,
    message: 'Logout successful — remove the token on the client (localStorage).'
  });
});

// Current user (requires Authorization: Bearer <token>)
router.get('/me', async (req, res) => {
  try {
    const h = req.headers.authorization;
    if (!h || !h.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated'
      });
    }

    let payload;
    try {
      payload = verifyToken(h.slice(7).trim());
    } catch {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }

    const user = await User.findById(payload.sub).select('-password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user: {
        ...userPayload(user),
        savedShippingAddress: user.savedShippingAddress || null,
        savedAddresses: Array.isArray(user.savedAddresses)
          ? user.savedAddresses.map((a) => a.toObject())
          : []
      }
    });
  } catch (error) {
    console.error('Auth check error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication check failed',
      error: error.message
    });
  }
});

/**
 * PATCH /api/auth/me/shipping — save default shipping address (JWT)
 */
router.patch('/me/shipping', requireJwtAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const doc = {
      firstName: String(b.firstName || '').trim(),
      lastName: String(b.lastName || '').trim(),
      email: String(b.email || '').trim(),
      phone: String(b.phone || '').trim(),
      street: String(b.street || '').trim(),
      city: String(b.city || '').trim(),
      state: String(b.state || '').trim(),
      zipCode: String(b.zipCode || '').trim(),
      country: String(b.country || '').trim()
    };
    await User.findByIdAndUpdate(req.authUserId, { $set: { savedShippingAddress: doc } });
    res.json({ success: true, message: 'Shipping address saved' });
  } catch (error) {
    console.error('Save shipping error:', error);
    res.status(500).json({ success: false, message: 'Could not save address' });
  }
});

/**
 * PATCH /api/auth/profile — name, email, phone (JWT)
 */
router.patch('/profile', requireJwtAuth, async (req, res) => {
  try {
    const user = await User.findById(req.authUserId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { name, email, phone } = req.body || {};
    if (name != null) user.name = String(name).trim().slice(0, 120);
    if (phone != null) user.phone = String(phone).trim().slice(0, 40);

    if (email != null) {
      const em = String(email).trim().toLowerCase();
      if (!em) {
        return res.status(400).json({ success: false, message: 'Email cannot be empty' });
      }
      const other = await User.findOne({
        email: em,
        _id: { $ne: user._id }
      }).select('_id');
      if (other) {
        return res.status(400).json({ success: false, message: 'Email already in use' });
      }
      user.email = em;
    }

    await user.save();
    res.json({
      success: true,
      message: 'Profile updated',
      user: {
        ...userPayload(user),
        savedShippingAddress: user.savedShippingAddress || null,
        savedAddresses: Array.isArray(user.savedAddresses)
          ? user.savedAddresses.map((a) => a.toObject())
          : []
      }
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ success: false, message: 'Could not update profile' });
  }
});

/**
 * POST /api/auth/change-password (JWT)
 */
router.post('/change-password', requireJwtAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'currentPassword and newPassword are required'
      });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters'
      });
    }

    const user = await User.findById(req.authUserId).select('+password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const okPw = await user.comparePassword(currentPassword);
    if (!okPw) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }

    user.password = newPassword;
    await user.save();

    res.json({ success: true, message: 'Password updated' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ success: false, message: 'Could not change password' });
  }
});

/**
 * POST /api/auth/avatar — multipart field "avatar" (JWT)
 */
router.post(
  '/avatar',
  requireJwtAuth,
  (req, res, next) => {
    avatarUpload.single('avatar')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ success: false, message: err.message || 'Invalid file' });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file?.buffer) {
        return res.status(400).json({ success: false, message: 'No image file provided' });
      }

      let url;
      try {
        const up = await uploadImageBuffer(req.file.buffer, { folder: 'nova-shop/avatars' });
        url = up.url;
      } catch (e) {
        console.error('Avatar upload:', e);
        return res.status(503).json({
          success: false,
          message:
            e.message ||
            'Image upload is not available. Configure Cloudinary or try again later.'
        });
      }

      const user = await User.findByIdAndUpdate(
        req.authUserId,
        { $set: { avatar: url } },
        { new: true }
      ).select('-password');

      res.json({
        success: true,
        message: 'Avatar updated',
        user: {
          ...userPayload(user),
          savedShippingAddress: user.savedShippingAddress || null,
          savedAddresses: Array.isArray(user.savedAddresses)
            ? user.savedAddresses.map((a) => a.toObject())
            : []
        }
      });
    } catch (error) {
      console.error('Avatar route error:', error);
      res.status(500).json({ success: false, message: 'Could not update avatar' });
    }
  }
);

/**
 * GET /api/auth/addresses — saved address book (JWT)
 */
router.get('/addresses', requireJwtAuth, async (req, res) => {
  try {
    const user = await User.findById(req.authUserId).select('savedAddresses');
    res.json({
      success: true,
      data: { addresses: user?.savedAddresses || [] }
    });
  } catch (error) {
    console.error('List addresses error:', error);
    res.status(500).json({ success: false, message: 'Could not load addresses' });
  }
});

/**
 * POST /api/auth/addresses (JWT)
 */
router.post('/addresses', requireJwtAuth, async (req, res) => {
  try {
    const user = await User.findById(req.authUserId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const doc = normalizeAddressInput(req.body);
    if (!doc.street || !doc.city || !doc.zipCode) {
      return res.status(400).json({
        success: false,
        message: 'street, city, and zipCode are required'
      });
    }

    const list = user.savedAddresses || [];
    if (doc.isDefault || list.length === 0) {
      list.forEach((a) => {
        a.isDefault = false;
      });
      doc.isDefault = true;
    }

    user.savedAddresses.push(doc);
    if (doc.isDefault) syncSavedShippingFromDefault(user);
    await user.save();

    const created = user.savedAddresses[user.savedAddresses.length - 1];
    res.status(201).json({
      success: true,
      message: 'Address saved',
      data: { address: created.toObject() }
    });
  } catch (error) {
    console.error('Create address error:', error);
    res.status(500).json({ success: false, message: 'Could not save address' });
  }
});

/**
 * PATCH /api/auth/addresses/:addressId (JWT)
 */
router.patch('/addresses/:addressId', requireJwtAuth, async (req, res) => {
  try {
    const { addressId } = req.params;
    if (!isValidObjectId(addressId)) {
      return res.status(400).json({ success: false, message: 'Invalid address id' });
    }

    const user = await User.findById(req.authUserId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const sub = user.savedAddresses.id(addressId);
    if (!sub) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }

    const doc = normalizeAddressInput({ ...sub.toObject(), ...req.body });
    if (!doc.street || !doc.city || !doc.zipCode) {
      return res.status(400).json({
        success: false,
        message: 'street, city, and zipCode are required'
      });
    }

    if (doc.isDefault) {
      user.savedAddresses.forEach((a) => {
        a.isDefault = false;
      });
    }

    Object.assign(sub, {
      label: doc.label,
      firstName: doc.firstName,
      lastName: doc.lastName,
      email: doc.email,
      phone: doc.phone,
      street: doc.street,
      city: doc.city,
      state: doc.state,
      zipCode: doc.zipCode,
      country: doc.country,
      isDefault: doc.isDefault
    });

    if (sub.isDefault) syncSavedShippingFromDefault(user);
    await user.save();

    res.json({
      success: true,
      message: 'Address updated',
      data: { address: sub.toObject() }
    });
  } catch (error) {
    console.error('Update address error:', error);
    res.status(500).json({ success: false, message: 'Could not update address' });
  }
});

/**
 * PATCH /api/auth/addresses/:addressId/default (JWT)
 */
router.patch('/addresses/:addressId/default', requireJwtAuth, async (req, res) => {
  try {
    const { addressId } = req.params;
    if (!isValidObjectId(addressId)) {
      return res.status(400).json({ success: false, message: 'Invalid address id' });
    }

    const user = await User.findById(req.authUserId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const sub = user.savedAddresses.id(addressId);
    if (!sub) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }

    user.savedAddresses.forEach((a) => {
      a.isDefault = String(a._id) === String(sub._id);
    });
    syncSavedShippingFromDefault(user);
    await user.save();

    res.json({ success: true, message: 'Default address updated' });
  } catch (error) {
    console.error('Set default address error:', error);
    res.status(500).json({ success: false, message: 'Could not set default' });
  }
});

/**
 * DELETE /api/auth/addresses/:addressId (JWT)
 */
router.delete('/addresses/:addressId', requireJwtAuth, async (req, res) => {
  try {
    const { addressId } = req.params;
    if (!isValidObjectId(addressId)) {
      return res.status(400).json({ success: false, message: 'Invalid address id' });
    }

    const user = await User.findById(req.authUserId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const sub = user.savedAddresses.id(addressId);
    if (!sub) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }

    const wasDefault = sub.isDefault;
    sub.deleteOne();
    if (wasDefault && user.savedAddresses.length) {
      user.savedAddresses[0].isDefault = true;
      syncSavedShippingFromDefault(user);
    }
    await user.save();

    res.json({ success: true, message: 'Address removed' });
  } catch (error) {
    console.error('Delete address error:', error);
    res.status(500).json({ success: false, message: 'Could not delete address' });
  }
});

/**
 * GET /api/auth/reviews — current user's reviews (JWT)
 */
router.get('/reviews', requireJwtAuth, async (req, res) => {
  try {
    const reviews = await Review.find({ user: req.authUserId })
      .sort({ createdAt: -1 })
      .populate('product', 'name slug images price')
      .lean();

    res.json({ success: true, data: { reviews } });
  } catch (error) {
    console.error('My reviews error:', error);
    res.status(500).json({ success: false, message: 'Could not load reviews' });
  }
});

module.exports = router;
