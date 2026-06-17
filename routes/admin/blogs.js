const express = require('express');
const mongoose = require('mongoose');
const BlogPost = require('../../models/BlogPost');
const { regenerateSitemapAutopilot } = require('../../lib/regenerateSitemapAutopilot');
const { runBlogContentAudit, auditBlogPostDocument, normalizeBlogHtml } = require('../../lib/blogContentAudit');
const {
  getSiteOrigin,
  getSiteName,
  extractSectionsFromHtml,
  buildBlogPostingSchema,
  estimateReadingMinutes
} = require('../../lib/blogSeo');
const { resolveBlogShopDestination } = require('../../lib/blogShopLink');

const router = express.Router();

function queueSitemapRefresh() {
  return regenerateSitemapAutopilot();
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
 * PUT /api/admin/blogs/:id
 * Update draft/published content after SEO audit validation.
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return fail(res, 400, 'Invalid blog id');
    }

    const title = String(req.body.title || req.body.h1 || '').trim();
    const metaTitle = String(req.body.metaTitle || '').trim();
    const summary = String(req.body.summary ?? req.body.description ?? '').trim();
    const content = String(req.body.content ?? req.body.body ?? '').trim();

    const existing = await BlogPost.findById(id).lean();
    if (!existing) {
      return fail(res, 404, 'Blog post not found');
    }

    const shopDest = await resolveBlogShopDestination({
      blogCategory: existing.category,
      tags: existing.tags,
      primaryKeyword: existing.primaryKeyword,
      currentLabel: existing.destinationLabel,
      currentUrl: existing.destinationUrl
    });

    const bodyHtml = normalizeBlogHtml(content, {
      shopPath: shopDest.destinationUrl || existing.destinationUrl || '/shop',
      blogSlug: existing.slug
    });

    const audit = runBlogContentAudit({
      title,
      metaTitle,
      summary,
      content: bodyHtml
    });
    if (!audit.ok) {
      return fail(res, 400, audit.message);
    }

    const sections = extractSectionsFromHtml(bodyHtml);
    const resolvedMetaTitle = metaTitle.slice(0, 120);
    const canonicalUrl = `${getSiteOrigin()}/blog/${encodeURIComponent(existing.slug)}`;
    const schemaObject = buildBlogPostingSchema({
      title,
      summary,
      slug: existing.slug,
      featuredImage: existing.featuredImage,
      datePublished: (existing.dateISO || new Date()).toISOString(),
      canonicalUrl
    });

    const post = await BlogPost.findByIdAndUpdate(
      id,
      {
        title: title.slice(0, 200),
        description: summary.slice(0, 320),
        metaTitle: resolvedMetaTitle,
        metaDescription: summary.slice(0, 320),
        body: bodyHtml,
        sections: sections.length ? sections : [],
        readingMinutes: estimateReadingMinutes(bodyHtml),
        schemaMarkup: JSON.stringify(schemaObject),
        destinationLabel: shopDest.destinationLabel,
        destinationUrl: shopDest.destinationUrl
      },
      { new: true, runValidators: true }
    ).lean();

    if (existing.status === 'published') {
      queueSitemapRefresh();
    }

    return ok(res, { post, message: 'Content audited and saved' });
  } catch (err) {
    return fail(res, 500, err.message || 'Content update failed');
  }
});

/**
 * PUT /api/admin/blogs/:id/publish
 * Publish only if stored content passes the SEO audit gatekeeper.
 */
router.put('/:id/publish', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return fail(res, 400, 'Invalid blog id');
    }

    const draft = await BlogPost.findById(id).lean();
    if (!draft) {
      return fail(res, 404, 'Blog post not found');
    }

    const shopDest = await resolveBlogShopDestination({
      blogCategory: draft.category,
      tags: draft.tags,
      primaryKeyword: draft.primaryKeyword,
      currentLabel: draft.destinationLabel,
      currentUrl: draft.destinationUrl
    });

    const normalizedBody = normalizeBlogHtml(String(draft.body || ''), {
      shopPath: shopDest.destinationUrl || draft.destinationUrl || '/shop',
      blogSlug: draft.slug
    });

    if (normalizedBody !== String(draft.body || '')) {
      const sections = extractSectionsFromHtml(normalizedBody);
      await BlogPost.findByIdAndUpdate(id, {
        body: normalizedBody,
        sections: sections.length ? sections : [],
        readingMinutes: estimateReadingMinutes(normalizedBody)
      });
    }

    const refreshed = await BlogPost.findById(id).lean();
    const audit = auditBlogPostDocument(refreshed, { siteName: getSiteName() });
    if (!audit.ok) {
      return fail(
        res,
        400,
        `${audit.message} Open Audit & Editor, fix issues, Save & validate, then publish.`
      );
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

    if (
      shopDest.destinationUrl !== post.destinationUrl ||
      shopDest.destinationLabel !== post.destinationLabel
    ) {
      await BlogPost.findByIdAndUpdate(id, {
        destinationLabel: shopDest.destinationLabel,
        destinationUrl: shopDest.destinationUrl
      });
    }

    queueSitemapRefresh().catch(() => {});
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
