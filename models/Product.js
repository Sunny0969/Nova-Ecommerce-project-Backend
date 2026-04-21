const crypto = require('crypto');
const mongoose = require('mongoose');
const slugify = require('slugify');

function randomAlphaSuffix(len = 4) {
  const a = 'abcdefghijklmnopqrstuvwxyz';
  let s = '';
  for (let i = 0; i < len; i += 1) s += a[crypto.randomInt(0, 26)];
  return s;
}

/** Same rules as admin `PUT` slug + `seoSlugFromTitle` (letters/hyphens, no digits). */
function normalizeSlugBase(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  return s
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/[0-9]+/g, '')
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
    /** Group variants or related SKUs within a category (arbitrary string) */
    variantGroupKey: {
      type: String,
      trim: true,
      maxlength: [120, 'Group key is too long'],
      default: '',
      index: true,
      sparse: true
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
    if (this.isModified('name') && !this.isNew) {
      this.slug = undefined;
    }

    /*
     * Always resolve a unique slug. If the client sends `slug` (admin form), we used to
     * `return next()` and skip the collision loop — duplicate slugs then hit Mongo 11000.
     */
    let base = '';
    const explicit = this.slug && String(this.slug).trim();
    if (explicit) {
      base = normalizeSlugBase(this.slug);
    } else {
      base = slugify(String(this.name), { lower: true, strict: true });
      base = normalizeSlugBase(base);
    }
    if (!base) base = 'product';

    let candidate = base;
    const Model = this.constructor;
    for (let tries = 0; tries < 40; tries += 1) {
      const q = { slug: candidate };
      if (this._id) q._id = { $ne: this._id };
      const exists = await Model.findOne(q).select('_id').lean();
      if (!exists) break;
      candidate = `${base}-${randomAlphaSuffix(4)}`;
    }
    this.slug = candidate;
    next();
  } catch (err) {
    next(err);
  }
});

productSchema.index({ category: 1, isPublished: 1 });
productSchema.index({ isFeatured: 1, isPublished: 1, createdAt: -1 });
productSchema.index({ isPublished: 1, numReviews: -1, ratings: -1 });
productSchema.index({ price: 1 });
productSchema.index({ name: 'text', description: 'text', tags: 'text' });
productSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Product', productSchema);
