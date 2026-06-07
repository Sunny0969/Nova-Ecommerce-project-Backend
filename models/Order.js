const mongoose = require('mongoose');

const shippingAddressSchema = new mongoose.Schema(
  {
    firstName: { type: String, trim: true, default: '' },
    lastName: { type: String, trim: true, default: '' },
    street: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    state: { type: String, trim: true, default: '' },
    zipCode: { type: String, trim: true, default: '' },
    country: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, default: '' }
  },
  { _id: false }
);

const paymentResultSchema = new mongoose.Schema(
  {
    id: { type: String, default: '' },
    status: { type: String, default: '' },
    update_time: { type: String, default: '' },
    email_address: { type: String, default: '' }
  },
  { _id: false }
);

const paymentProofSchema = new mongoose.Schema(
  {
    transactionId: { type: String, trim: true, default: '', maxlength: 120 },
    imageUrl: { type: String, trim: true, default: '' },
    imagePublicId: { type: String, trim: true, default: '' },
    submittedAt: { type: Date, default: null }
  },
  { _id: false }
);

const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    name: { type: String, required: true, trim: true },
    image: { type: String, default: '' },
    price: { type: Number, required: true, min: 0 },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: 'Quantity must be an integer'
      }
    }
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    orderItems: {
      type: [orderItemSchema],
      validate: [
        (v) => Array.isArray(v) && v.length > 0,
        'Order must contain at least one item'
      ]
    },
    shippingAddress: {
      type: shippingAddressSchema,
      default: () => ({})
    },
    paymentMethod: {
      type: String,
      default: '',
      trim: true
    },
    paymentResult: {
      type: paymentResultSchema,
      default: () => ({})
    },
    /** Easypaisa / bank transfer — transaction ID and screenshot */
    paymentProof: {
      type: paymentProofSchema,
      default: () => ({})
    },
    itemsPrice: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    taxPrice: {
      type: Number,
      default: 0,
      min: 0
    },
    shippingPrice: {
      type: Number,
      default: 0,
      min: 0
    },
    totalPrice: {
      type: Number,
      required: true,
      min: 0
    },
    isPaid: {
      type: Boolean,
      default: false,
      index: true
    },
    paidAt: {
      type: Date,
      default: null
    },
    isDelivered: {
      type: Boolean,
      default: false,
      index: true
    },
    deliveredAt: {
      type: Date,
      default: null
    },
    status: {
      type: String,
      enum: [
        'pending',
        'processing',
        'shipped',
        'delivered',
        'cancelled',
        'flagged',
        'rejected'
      ],
      default: 'pending',
      index: true
    },
    trackingNumber: {
      type: String,
      trim: true,
      default: '',
      index: true
    },
    cancelReason: {
      type: String,
      default: '',
      maxlength: 1000
    },
    notes: {
      type: String,
      default: '',
      maxlength: 2000
    },
    coupon: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Coupon',
      default: null,
      index: true
    },
    discountAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    stripePaymentIntentId: {
      type: String,
      trim: true,
      default: '',
      sparse: true,
      index: true
    },
    deliveryOption: {
      type: String,
      trim: true,
      default: 'standard'
    },
    /** Client IP at checkout (fraud / support) */
    clientIp: {
      type: String,
      trim: true,
      default: '',
      index: true
    },
    /** Stripe card fingerprint when available */
    paymentCardFingerprint: {
      type: String,
      trim: true,
      default: '',
      sparse: true,
      index: true
    },
    fraudRiskScore: {
      type: Number,
      min: 0,
      max: 100
    },
    fraudFactors: {
      type: [
        {
          code: String,
          detail: String,
          weight: Number
        }
      ],
      default: () => []
    }
  },
  { timestamps: true }
);

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ createdAt: -1 });

orderSchema.virtual('items').get(function () {
  return this.orderItems;
});

orderSchema.set('toJSON', { virtuals: true });
orderSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Order', orderSchema);
