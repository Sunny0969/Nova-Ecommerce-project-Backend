const mongoose = require('mongoose');

const userNotificationPreferencesSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true
    },
    /** Category ObjectIds — notify when new products publish in these categories */
    favoriteCategoryIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category'
      }
    ],
    priceAlertsEnabled: { type: Boolean, default: true },
    orderUpdatesEnabled: { type: Boolean, default: true },
    dealsEnabled: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('UserNotificationPreferences', userNotificationPreferencesSchema);
