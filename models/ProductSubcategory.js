const mongoose = require('mongoose');
const slugify = require('slugify');

const productSubcategorySchema = new mongoose.Schema(
  {
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
      index: true
    },
    /** Empty for flat categories (e.g. snacks); women/men for clothing */
    gender: {
      type: String,
      enum: ['', 'women', 'men'],
      default: '',
      index: true
    },
    name: {
      type: String,
      required: [true, 'Subcategory name is required'],
      trim: true,
      maxlength: [80, 'Name is too long']
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },
    /** Title keywords for auto-matching products (e.g. biscuit, wafer) */
    matchKeywords: {
      type: [String],
      default: []
    },
    displayOrder: {
      type: Number,
      default: 0
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    }
  },
  { timestamps: true }
);

productSubcategorySchema.index({ category: 1, gender: 1, slug: 1 }, { unique: true });

productSubcategorySchema.pre('validate', function setSlug(next) {
  if (!this.slug && this.name) {
    this.slug = slugify(String(this.name), { lower: true, strict: true });
  }
  next();
});

module.exports = mongoose.model('ProductSubcategory', productSubcategorySchema);
