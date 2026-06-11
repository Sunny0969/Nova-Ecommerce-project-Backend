const mongoose = require('mongoose');
const slugify = require('slugify');

/**
 * Public URL path segment: derived only from the product `name` (title).
 * Keeps a–z, 0–9, and hyphens (e.g. "20W" stays in the slug).
 */
function normalizeTitleSlugFromName(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  return s
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, default: '' },
    public_id: { type: String, default: '' }
  },
  { _id: false }
);

const embeddedReviewSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },
    comment: {
      type: String,
      default: '',
      maxlength: [2000, 'Comment is too long']
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  },
  { _id: true }
);

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      maxlength: [200, 'Name cannot exceed 200 characters']
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
      index: true
    },
    /** Optional stable id for imports / legacy indexes (unique when set) */
    productId: {
      type: String,
      trim: true,
      sparse: true,
      unique: true
    },
    description: {
      type: String,
      default: ''
    },
    shortDescription: {
      type: String,
      default: '',
      maxlength: [500, 'Short description is too long']
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative']
    },
    comparePrice: {
      type: Number,
      min: [0, 'Compare price cannot be negative'],
      default: null
    },
    costPrice: {
      type: Number,
      min: [0, 'Cost price cannot be negative'],
      default: null
    },
    images: {
      type: [imageSchema],
      default: []
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'Category is required'],
      index: true
    },
    tags: {
      type: [String],
      default: [],
      index: true
    },
    /** Optional apparel / variant metadata */
    color: {
      type: String,
      trim: true,
      maxlength: [120, 'Color is too long'],
      default: ''
    },
    texture: {
      type: String,
      trim: true,
      maxlength: [120, 'Texture is too long'],
      default: ''
    },
    size: {
      type: String,
      trim: true,
      maxlength: [120, 'Size is too long'],
      default: ''
    },
    weight: {
      type: String,
      trim: true,
      maxlength: [120, 'Weight is too long'],
      default: ''
    },
    /** Shipping weight in kilograms (used for weight-based delivery charges). */
    weightKg: {
      type: Number,
      min: [0, 'Weight cannot be negative'],
      default: null
    },
    /** Group variants or related SKUs within a category (arbitrary string) */
    variantGroupKey: {
      type: String,
      trim: true,
      maxlength: [120, 'Group key is too long'],
      default: '',
      index: true,
      sparse: true
    },
    /** Structured options: color / shape / size, each with optional swatch images (Cloudinary). */
    variantAxes: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({})
    },
    stock: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'Stock cannot be negative'],
      index: true
    },
    /** When stock falls below this, show low-stock in admin/ops (null = not set) */
    lowStockThreshold: {
      type: Number,
      min: 0,
      default: null
    },
    sku: {
      type: String,
      trim: true,
      sparse: true,
      index: true
    },
    isFeatured: {
      type: Boolean,
      default: false,
      index: true
    },
    isPublished: {
      type: Boolean,
      default: false,
      index: true
    },
    approvalStatus: {
      type: String,
      enum: ['pending_approval', 'approved', 'rejected'],
      default: 'approved',
      index: true
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    approvedAt: {
      type: Date,
      default: null
    },
    rejectionReason: {
      type: String,
      default: ''
    },
    submittedByStaff: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StaffAccess',
      default: null,
      index: true
    },
    ratings: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    numReviews: {
      type: Number,
      default: 0,
      min: 0
    },
    reviews: [embeddedReviewSchema]
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

productSchema.virtual('discountPercentage').get(function () {
  const compare = this.comparePrice;
  const price = this.price;
  if (compare == null || compare <= 0 || price == null) return 0;
  if (price >= compare) return 0;
  return Math.round(((compare - price) / compare) * 10000) / 100;
});

productSchema.pre('save', async function (next) {
  try {
    let base = normalizeTitleSlugFromName(
      slugify(String(this.name || 'Product'), { lower: true, strict: true, trim: true })
    );
    if (!base) base = 'product';

    const Model = this.constructor;
    for (let n = 0; n < 200; n += 1) {
      const candidate = n === 0 ? base : `${base}-${n + 1}`;
      const q = { slug: candidate };
      if (this._id) q._id = { $ne: this._id };
      const taken = await Model.findOne(q).select('_id').lean();
      if (!taken) {
        this.slug = candidate;
        return next();
      }
    }
    return next(new Error('Could not allocate a unique product slug from title'));
  } catch (err) {
    return next(err);
  }
});

productSchema.index({ category: 1, isPublished: 1 });
productSchema.index({ category: 1, isPublished: 1, createdAt: -1 });
productSchema.index({ category: 1, isPublished: 1, price: 1 });
productSchema.index({ category: 1, name: 1 });
productSchema.index({ isFeatured: 1, isPublished: 1, createdAt: -1 });
productSchema.index({ isPublished: 1, numReviews: -1, ratings: -1 });
productSchema.index({ isPublished: 1, createdAt: -1 });
productSchema.index({ isPublished: 1, stock: 1, createdAt: -1 });
productSchema.index({ approvalStatus: 1, createdAt: -1 });
productSchema.index({ price: 1 });
productSchema.index({ name: 'text', description: 'text', tags: 'text' });
productSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Product', productSchema);
