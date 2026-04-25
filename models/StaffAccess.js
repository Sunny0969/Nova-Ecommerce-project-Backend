const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const permissionsSchema = new mongoose.Schema(
  {
    manageProducts: { type: Boolean, default: false },
    manageCategories: { type: Boolean, default: false },
    manageOrders: { type: Boolean, default: false },
    manageBlog: { type: Boolean, default: false },
    manageCustomers: { type: Boolean, default: false },
    viewAnalytics: { type: Boolean, default: false },
    manageCoupons: { type: Boolean, default: false }
  },
  { _id: false }
);

const staffAccessSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Staff email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
    },
    password: {
      type: String,
      required: [true, 'Staff password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false
    },
    name: {
      type: String,
      required: [true, 'Staff name is required'],
      trim: true,
      maxlength: [120, 'Name cannot exceed 120 characters']
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      index: true
    },
    status: {
      type: String,
      enum: ['active', 'blocked'],
      default: 'active',
      index: true
    },
    blockedUntil: {
      type: Date,
      default: null,
      index: true
    },
    permissions: {
      type: permissionsSchema,
      default: () => ({})
    },
    lastLogin: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

staffAccessSchema.index({ email: 1 });
staffAccessSchema.index({ status: 1, blockedUntil: 1 });

staffAccessSchema.pre('save', async function (next) {
  try {
    if (!this.isModified('password')) {
      return next();
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    return next();
  } catch (err) {
    return next(err);
  }
});

staffAccessSchema.methods.comparePassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

staffAccessSchema.methods.getJWTToken = function () {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  return jwt.sign(
    {
      sub: this._id.toString(),
      email: this.email,
      name: this.name,
      role: 'staff',
      permissions: this.permissions || {}
    },
    secret,
    { expiresIn: process.env.JWT_EXPIRE || process.env.JWT_EXPIRES_IN || '7d' }
  );
};

module.exports = mongoose.model('StaffAccess', staffAccessSchema);

