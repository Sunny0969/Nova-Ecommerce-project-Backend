const mongoose = require('mongoose');

/**
 * Search analytics stream.
 * - `type=query`: emitted when a search endpoint runs.
 * - `type=click`: emitted when user clicks an autocomplete/ai-search result.
 */
const searchAnalyticsEventSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['query', 'click'],
      required: true,
      index: true
    },
    query: {
      type: String,
      trim: true,
      default: '',
      maxlength: 400
    },
    resultsCount: {
      type: Number,
      default: 0,
      min: 0
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
      index: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    sessionId: {
      type: String,
      trim: true,
      default: '',
      maxlength: 200
    },
    clientIp: {
      type: String,
      trim: true,
      default: ''
    },
    source: {
      type: String,
      trim: true,
      default: '',
      maxlength: 80
    }
  },
  { timestamps: true }
);

searchAnalyticsEventSchema.index({ type: 1, createdAt: -1 });
searchAnalyticsEventSchema.index({ query: 1, createdAt: -1 });

module.exports = mongoose.model('SearchAnalyticsEvent', searchAnalyticsEventSchema);

