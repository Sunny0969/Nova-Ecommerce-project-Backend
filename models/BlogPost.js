const mongoose = require('mongoose');

function normalizeSlug(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s;
}

const blogPostSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },

    /**
     * URL slug used by frontend routing: /blog/:slug
     * Unique across posts.
     */
    slug: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true
    },

    category: { type: String, required: true, index: true, trim: true },

    description: { type: String, default: '', maxlength: 2000 },

    tag: { type: String, default: '', trim: true },

    featuredImage: { type: String, default: '' },
    imageAlt: { type: String, default: '' },

    destinationLabel: { type: String, default: '' },
    destinationUrl: { type: String, default: '' },

    readingMinutes: { type: Number, default: 5, min: 1, max: 60 },

    /** Publish date shown on the page */
    dateISO: { type: Date, required: true, index: true },

    /** Internal sorting date (if you want separate from dateISO) */
    sortDate: { type: Date, default: null, index: true },

    /**
     * Blog status for CMS workflows.
     * - draft: hidden from public listing/details
     * - published: visible publicly
     */
    status: {
      type: String,
      enum: ['draft', 'published'],
      default: 'published',
      index: true
    },

    /** Optional full article body (plain text / HTML / markdown). */
    body: { type: String, default: '' },

    /**
     * Structured sections for TOC + content rendering on the blog detail page.
     * If present, frontend will render from these sections.
     */
    sections: [
      {
        title: { type: String, default: '' },
        content: { type: String, default: '' }
      }
    ]
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

blogPostSchema.index({ status: 1, category: 1, dateISO: -1 });

blogPostSchema.pre('validate', function (next) {
  if (this.slug) {
    this.slug = normalizeSlug(this.slug);
    if (!this.slug) this.slug = normalizeSlug(this.title);
    return next();
  }
  this.slug = normalizeSlug(this.title);
  next();
});

module.exports = mongoose.model('BlogPost', blogPostSchema);

