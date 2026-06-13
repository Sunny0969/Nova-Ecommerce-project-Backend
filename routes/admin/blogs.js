const express = require('express');
const mongoose = require('mongoose');
const BlogPost = require('../../models/BlogPost');
const { regenerateSitemapAutopilot } = require('../../lib/regenerateSitemapAutopilot');

const router = express.Router();

function queueSitemapRefresh() {
  void regenerateSitemapAutopilot();
}
function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

/**
 * GET /api/admin/blogs
 * List all blog posts (draft + published) for admin review.
 */
router.get('/', async (req, res) => {
  try {
    const { status, sort } = req.query;
    const filter = {};
    if (status === 'draft' || status === 'published') {
      filter.status = status;
    }

    const mongoSort =
      String(sort || '').toLowerCase() === 'oldest'
        ? { dateISO: 1, createdAt: 1 }
        : { dateISO: -1, createdAt: -1 };

    const posts = await BlogPost.find(filter).sort(mongoSort).lean();
    const draftCount = await BlogPost.countDocuments({ status: 'draft' });

    return ok(res, {
      posts: posts.map((p) => ({ ...p, id: p._id })),
      count: posts.length,
      draftCount
    });
  } catch (err) {
    return fail(res, 500, err.message || 'Failed to load blogs');
  }
});

/**
 * GET /api/admin/blogs/stats — draft count for sidebar badge
 */
router.get('/stats', async (req, res) => {
  try {
    const [draftCount, publishedCount, totalCount] = await Promise.all([
      BlogPost.countDocuments({ status: 'draft' }),
      BlogPost.countDocuments({ status: 'published' }),
      BlogPost.estimatedDocumentCount()
    ]);
    return ok(res, { draftCount, publishedCount, totalCount });
  } catch (err) {
    return fail(res, 500, err.message || 'Failed to load blog stats');
  }
});

/**
 * PUT /api/admin/blogs/:id/publish
 */
router.put('/:id/publish', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return fail(res, 400, 'Invalid blog id');
    }

    const post = await BlogPost.findByIdAndUpdate(
      id,
      {
        status: 'published',
        dateISO: new Date()
      },
      { new: true, runValidators: true }
    ).lean();

    if (!post) {
      return fail(res, 404, 'Blog post not found');
    }

    queueSitemapRefresh();
    return ok(res, { post, message: 'Blog published to live site' });
  } catch (err) {
    return fail(res, 400, err.message || 'Publish failed');
  }
});

/**
 * PUT /api/admin/blogs/:id/unpublish — move back to draft
 */
router.put('/:id/unpublish', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return fail(res, 400, 'Invalid blog id');
    }

    const post = await BlogPost.findByIdAndUpdate(
      id,
      { status: 'draft' },
      { new: true, runValidators: true }
    ).lean();

    if (!post) {
      return fail(res, 404, 'Blog post not found');
    }

    queueSitemapRefresh();
    return ok(res, { post, message: 'Blog moved to draft' });
  } catch (err) {
    return fail(res, 400, err.message || 'Unpublish failed');
  }
});

/**
 * DELETE /api/admin/blogs/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return fail(res, 400, 'Invalid blog id');
    }

    const post = await BlogPost.findByIdAndDelete(id).lean();
    if (!post) {
      return fail(res, 404, 'Blog post not found');
    }

    queueSitemapRefresh();
    return ok(res, { id: String(post._id), message: 'Blog deleted' });
  } catch (err) {
    return fail(res, 500, err.message || 'Delete failed');
  }
});

module.exports = router;
