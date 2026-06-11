const crypto = require('crypto');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const savedAddressSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true, default: 'Home', maxlength: 80 },
    firstName: { type: String, trim: true, default: '' },
    lastName: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    street: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    state: { type: String, trim: true, default: '' },
    zipCode: { type: String, trim: true, default: '' },
    country: { type: String, trim: true, default: '' },
    isDefault: { type: Boolean, default: false }
  },
  { timestamps: true }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please enter your name'],
      trim: true,
      maxlength: [120, 'Name cannot exceed 120 characters']
    },
    email: {
      type: String,
      required: [true, 'Please enter your email'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
    },
    password: {
      type: String,
      required: [true, 'Please enter your password'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false
    },
    role: {
      type: String,
      enum: ['customer', 'admin'],
      default: 'customer'
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    avatar: {
      type: String,
      default: ''
    },
    phone: {
      type: String,
      trim: true,
      default: ''
    },
    isVerified: {
      type: Boolean,
      default: false
    },
    verificationToken: {
      type: String,
      select: false
    },
    resetPasswordToken: {
      type: String,
      select: false
    },
    resetPasswordExpire: {
      type: Date,
      select: false
    },
    /** Last saved checkout shipping (optional) */
    savedShippingAddress: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    /** Saved address book (separate from one-off checkout save) */
    savedAddresses: {
      type: [savedAddressSchema],
      default: () => []
    },
    /** True when account was auto-created during guest checkout (activate via Register). */
    createdViaGuestCheckout: {
      type: Boolean,
      default: false,
      index: true
    },
    /** Store credit balance (PKR) — updated via WalletTransaction ledger. */
    walletBalance: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  { timestamps: true }
);

userSchema.index({ email: 1 });
userSchema.index({ role: 1 });

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.getJWTToken = function () {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  return jwt.sign(
    { sub: this._id.toString(), email: this.email, role: this.role },
    secret,
    { expiresIn: process.env.JWT_EXPIRE || process.env.JWT_EXPIRES_IN || '7d' }
  );
};

/**
 * Generates a reset token, stores a hashed version + expiry on the user.
 * @returns {string} Plain reset token to send by email (not the hash).
 */
userSchema.methods.getResetPasswordToken = function () {
  const resetToken = crypto.randomBytes(20).toString('hex');
  this.resetPasswordToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
  this.resetPasswordExpire = Date.now() + 15 * 60 * 1000;
  return resetToken;
};

module.exports = mongoose.model('User', userSchema);
