const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();

const BlogPost = require('../models/BlogPost');
const requireAdmin = require('../middleware/requireAdmin');

function ok(res, data, status = 200, extra = {}) {
  return res.status(status).json({ success: true, data, ...extra });
}

function fail(res, status, message, errors = undefined) {
  const body = { success: false, message };
  if (errors && Object.keys(errors).length) body.errors = errors;
  return res.status(status).json(body);
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function normalizeSlugInput(slug) {
  return String(slug || '').trim().toLowerCase();
}

function applyPublicFilter(filter, requirePublished = true) {
  if (requirePublished) {
    filter.status = 'published';
  }
  return filter;
}

function buildListFilter({ category, q, status }) {
  const filter = {};

  const cat = category && String(category).trim();
  if (cat && cat !== 'All') {
    filter.category = String(cat);
  }

  const term = q && String(q).trim();
  if (term) {
    filter.$or = [
      { title: { $regex: term, $options: 'i' } },
      { description: { $regex: term, $options: 'i' } },
      { tag: { $regex: term, $options: 'i' } },
      { category: { $regex: term, $options: 'i' } },
      { destinationLabel: { $regex: term, $options: 'i' } }
    ];
  }

  if (status && String(status).trim()) {
    const s = String(status).trim().toLowerCase();
    if (s === 'draft' || s === 'published') {
      filter.status = s;
    }
  }

  return filter;
}

function buildListSort(sort) {
  const s = String(sort || '').toLowerCase();
  if (s === 'oldest') return { dateISO: 1 };
  if (s === 'popular') return { readingMinutes: -1, dateISO: -1 };
  return { dateISO: -1 };
}

// -----------------------------------------------------------------------------
// Existing routes (KEEP to avoid breaking existing frontend)
// -----------------------------------------------------------------------------

// GET /api/blog/posts?category=Tech&q=usb&sort=newest|oldest|popular
router.get('/posts', async (req, res) => {
  try {
    const { category, q, sort } = req.query;

    const filter = applyPublicFilter(buildListFilter({ category, q, status: 'published' }), false);
    // Public route: published only
    filter.status = 'published';

    const mongoSort = buildListSort(sort);
    const posts = await BlogPost.find(filter).sort(mongoSort).lean();

    const shaped = posts.map((p) => ({ ...p, id: p._id }));

    return res.json({ success: true, count: posts.length, posts: shaped });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/blog/posts/:slug
router.get('/posts/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const post = await BlogPost.findOne({ slug: normalizeSlugInput(slug), status: 'published' }).lean();

    if (!post) {
      return res.status(404).json({ success: false, message: 'Blog post not found' });
    }

    const { enrichBlogPost } = require('../lib/blogShopLink');
    const enriched = await enrichBlogPost(post);

    return res.json({ success: true, post: enriched });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// -----------------------------------------------------------------------------
// New required Blog API (CRUD + /api/blogs endpoints)
// -----------------------------------------------------------------------------

// GET /api/blogs?category=Tech&q=usb&sort=newest|oldest|popular&status=published|draft
router.get('/', async (req, res) => {
  try {
    const { category, q, sort, status } = req.query;

    // Public by default: published only. If admin wants drafts, use status.
    const filter = buildListFilter({ category, q, status });
    if (!status) {
      filter.status = 'published';
    }

    const mongoSort = buildListSort(sort);
    const posts = await BlogPost.find(filter).sort(mongoSort).lean();

    return res.json({ success: true, count: posts.length, posts });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/blogs/:slug
router.get('/:slug', async (req, res) => {
  try {
    const slug = normalizeSlugInput(req.params.slug);
    const post = await BlogPost.findOne({ slug, status: 'published' }).lean();

    if (!post) {
      return res.status(404).json({ success: false, message: 'Blog post not found' });
    }

    const { enrichBlogPost } = require('../lib/blogShopLink');
    const enriched = await enrichBlogPost(post);

    return res.json({ success: true, post: enriched });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/blogs/id/:id (optional convenience)
router.get('/id/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid blog id' });
    }
    const post = await BlogPost.findOne({ _id: id, status: 'published' }).lean();
    if (!post) {
      return res.status(404).json({ success: false, message: 'Blog post not found' });
    }
    return res.json({ success: true, post });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/blogs (admin)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};

    const payload = {
      title: body.title,
      slug: body.slug,
      category: body.category,
      description: body.description,
      tag: body.tag,
      featuredImage: body.featuredImage,
      imageAlt: body.imageAlt,
      destinationLabel: body.destinationLabel,
      destinationUrl: body.destinationUrl,
      readingMinutes: body.readingMinutes,
      dateISO: body.dateISO ? new Date(body.dateISO) : undefined,
      sortDate: body.sortDate ? new Date(body.sortDate) : undefined,
      status: body.status === 'draft' ? 'draft' : 'published',
      body: body.body,
      sections: Array.isArray(body.sections) ? body.sections : undefined,
      tags: Array.isArray(body.tags) ? body.tags : undefined,
      metaTitle: body.metaTitle,
      metaDescription: body.metaDescription,
      schemaMarkup: body.schemaMarkup,
      primaryKeyword: body.primaryKeyword
    };

    // Tidy optional fields
    if (payload.description === undefined) delete payload.description;
    if (payload.tag === undefined) delete payload.tag;
    if (payload.featuredImage === undefined) delete payload.featuredImage;
    if (payload.imageAlt === undefined) delete payload.imageAlt;
    if (payload.destinationLabel === undefined) delete payload.destinationLabel;
    if (payload.destinationUrl === undefined) delete payload.destinationUrl;
    if (payload.readingMinutes === undefined) delete payload.readingMinutes;
    if (payload.sortDate === undefined) delete payload.sortDate;
    if (payload.sections === undefined) delete payload.sections;

    // Basic validation (mongoose will handle required)
    const post = await BlogPost.create(payload);
    return res.status(201).json({ success: true, post });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Slug must be unique' });
    }
    return res.status(400).json({ success: false, error: err.message });
  }
});

// PUT /api/blogs/:id
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid blog id' });
    }

    const body = req.body || {};

    const update = {
      title: body.title,
      slug: body.slug,
      category: body.category,
      description: body.description,
      tag: body.tag,
      featuredImage: body.featuredImage,
      imageAlt: body.imageAlt,
      destinationLabel: body.destinationLabel,
      destinationUrl: body.destinationUrl,
      readingMinutes: body.readingMinutes,
      dateISO: body.dateISO ? new Date(body.dateISO) : undefined,
      sortDate: body.sortDate ? new Date(body.sortDate) : undefined,
      status: body.status === 'draft' ? 'draft' : 'published',
      body: body.body,
      sections: Array.isArray(body.sections) ? body.sections : undefined,
      tags: Array.isArray(body.tags) ? body.tags : undefined,
      metaTitle: body.metaTitle,
      metaDescription: body.metaDescription,
      schemaMarkup: body.schemaMarkup,
      primaryKeyword: body.primaryKeyword
    };

    // Remove undefined keys (so we don't accidentally overwrite)
    for (const key of Object.keys(update)) {
      if (update[key] === undefined) delete update[key];
    }

    const post = await BlogPost.findByIdAndUpdate(id, update, { new: true, runValidators: true }).lean();
    if (!post) {
      return res.status(404).json({ success: false, message: 'Blog post not found' });
    }
    return res.json({ success: true, post });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Slug must be unique' });
    }
    return res.status(400).json({ success: false, error: err.message });
  }
});

// DELETE /api/blogs/:id
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid blog id' });
    }

    const post = await BlogPost.findByIdAndDelete(id).lean();
    if (!post) {
      return res.status(404).json({ success: false, message: 'Blog post not found' });
    }

    return res.json({ success: true, message: 'Blog post deleted', data: { id: String(post._id) } });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/blog/categories (for frontend filter dropdown)
router.get('/categories', async (req, res) => {
  try {
    // Public categories: distinct categories from published posts
    const categories = await BlogPost.distinct('category', { status: 'published' });
    return res.json({ success: true, categories });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;


