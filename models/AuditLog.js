const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
      index: true
    },
    actorName: {
      type: String,
      required: true,
      trim: true
    },
    actorEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    actorRole: {
      type: String,
      enum: ['admin', 'staff', 'system'],
      default: 'staff',
      index: true
    },
    action: {
      type: String,
      required: true,
      trim: true,
      index: true
      // e.g., 'UPDATE_PRODUCT_PRICE', 'UPDATE_PRODUCT_STOCK', 'UPDATE_ORDER_STATUS', 'CREATE_PRODUCT', etc.
    },
    targetType: {
      type: String,
      enum: ['product', 'order', 'category', 'coupon', 'staff'],
      required: true,
      index: true
    },
    targetId: {
      type: String,
      default: '',
      index: true
    },
    targetTitle: {
      type: String,
      default: ''
    },
    description: {
      type: String,
      required: true
    },
    changes: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    ipAddress: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);

