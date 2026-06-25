const mongoose = require('mongoose');

const notificationLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true
    },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    type: { type: String, default: 'general', index: true },
    status: {
      type: String,
      enum: ['sent', 'failed', 'skipped'],
      default: 'sent',
      index: true
    },
    meta: { type: mongoose.Schema.Types.Mixed, default: null }
  },
  { timestamps: { createdAt: 'sentAt', updatedAt: false } }
);

module.exports = mongoose.model('NotificationLog', notificationLogSchema);
