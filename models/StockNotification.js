const mongoose = require('mongoose');

const stockNotificationSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: [254, 'Email is too long']
    }
  },
  { timestamps: true }
);

stockNotificationSchema.index({ product: 1, email: 1 }, { unique: true });

module.exports = mongoose.model('StockNotification', stockNotificationSchema);
