const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, default: '' },
    public_id: { type: String, default: '' }
  },
  { _id: false }
);

const brandSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true
    },
    image: {
      type: imageSchema,
      default: () => ({})
    },
    isPopular: {
      type: Boolean,
      default: false,
      index: true
    },
    displayOrder: {
      type: Number,
      default: 0,
      index: true
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Brand', brandSchema);
