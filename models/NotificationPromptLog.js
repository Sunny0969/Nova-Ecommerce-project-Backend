const mongoose = require('mongoose');

const CHOICES = ['allowed', 'dismissed', 'denied'];

const notificationPromptLogSchema = new mongoose.Schema(
  {
    choice: {
      type: String,
      enum: CHOICES,
      required: true,
      index: true
    },
    guestKey: { type: String, default: '', index: true, trim: true },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    clientIp: { type: String, default: '', trim: true },
    userAgent: { type: String, default: '' },
    pageUrl: { type: String, default: '', trim: true },
    browserPermission: { type: String, default: '' },
    subscribed: { type: Boolean, default: false }
  },
  { timestamps: true }
);

notificationPromptLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('NotificationPromptLog', notificationPromptLogSchema);
module.exports.PROMPT_CHOICES = CHOICES;
