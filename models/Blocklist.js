const mongoose = require('mongoose');

const blocklistSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['ip', 'email', 'card_fingerprint'],
      required: true,
      index: true
    },
    value: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 512
    },
    reason: {
      type: String,
      trim: true,
      default: '',
      maxlength: 500
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    expiresAt: {
      type: Date,
      default: null,
      index: true
    }
  },
  { timestamps: true }
);

blocklistSchema.index({ type: 1, value: 1 }, { unique: true });

module.exports = mongoose.model('Blocklist', blocklistSchema);
