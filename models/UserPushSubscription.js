const mongoose = require('mongoose');

/**
 * Web Push subscription per browser endpoint.
 * Guests: user is null, identified by endpoint + guestKey.
 * Logged-in: user is set; same endpoint is linked on subscribe after login.
 */
const userPushSubscriptionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    endpoint: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    subscription: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    isGuest: {
      type: Boolean,
      default: true,
      index: true
    },
    /** Browser-local id (localStorage) — helps re-link guest device after refresh */
    guestKey: { type: String, default: '', index: true, trim: true },
    /** Last seen IP (analytics / abuse prevention; delivery uses endpoint, not IP) */
    clientIp: { type: String, default: '', trim: true },
    userAgent: { type: String, default: '' }
  },
  { timestamps: true }
);

userPushSubscriptionSchema.index({ user: 1, isActive: 1 });
userPushSubscriptionSchema.index({ isGuest: 1, isActive: 1 });

module.exports = mongoose.model('UserPushSubscription', userPushSubscriptionSchema);
