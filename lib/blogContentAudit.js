/**
 * SEO content audit gatekeeper — enforces checklist before blog updates.
 */

const {
  auditBlogLinkQuotas,
  auditBlogSectionOrder,
  normalizeBlogHtml
} = require('./blogContentStructure');

function runBlogContentAudit({ title, metaTitle, summary, content }) {
  const h1 = String(title || '').trim();
  const metaTitleStr = String(metaTitle || '').trim();
  const summaryStr = String(summary || '').trim();
  const contentStr = String(content || '').trim();

  if (!h1) {
    return { ok: false, message: 'SEO Audit Failed: H1 / article title is required.' };
  }

  if (h1.length > 120) {
    return {
      ok: false,
      message: 'SEO Audit Failed: H1 heading exceeds 120 characters.'
    };
  }

  if (!metaTitleStr) {
    return { ok: false, message: 'SEO Audit Failed: Meta title (browser tab) is required.' };
  }

  if (metaTitleStr.length > 60) {
    return {
      ok: false,
      message: 'SEO Audit Failed: Meta title exceeds 60 characters.'
    };
  }

  if (!summaryStr) {
    return { ok: false, message: 'SEO Audit Failed: Meta description is required.' };
  }

  if (summaryStr.length > 165) {
    return {
      ok: false,
      message:
        'SEO Audit Failed: Meta Description exceeds max semantic limit (155–160 characters).'
    };
  }

  if (!contentStr) {
    return { ok: false, message: 'SEO Audit Failed: Article body is required.' };
  }

  const h1Count = (contentStr.match(/<h1[^>]*>/gi) || []).length;
  if (h1Count > 0) {
    return {
      ok: false,
      message:
        'SEO Audit Failed: Article body contains an <h1> tag. The main title is automatically mapped to <h1>. Body must use strictly <h2> and <h3> sub-sections.'
    };
  }

  const h2Count = (contentStr.match(/<h2[^>]*>/gi) || []).length;
  if (h2Count < 2) {
    return {
      ok: false,
      message:
        'SEO Audit Failed: Article structure requires logical sub-sections. Please add informational <h2> tags for sections like Overview, FAQs, or Comparisons.'
    };
  }

  const lower = contentStr.toLowerCase();
  if (
    !lower.includes('<ul>') &&
    !lower.includes('<ol>') &&
    !lower.includes('<table')
  ) {
    return {
      ok: false,
      message:
        'SEO Audit Failed: Quality rule broken. Article lacks structural readability components (bullet points or relational tables).'
    };
  }

  if (
    lower.includes('guaranteed cheap') ||
    lower.includes('best price promise')
  ) {
    return {
      ok: false,
      message:
        "SEO Audit Failed: Avoid robotic or high-risk legal/financial promises like 'guaranteed' or 'cheap'. Use descriptive value ranges instead to score high on Google EEAT."
    };
  }

  const sectionAudit = auditBlogSectionOrder(contentStr);
  if (!sectionAudit.ok) {
    return sectionAudit;
  }

  const linkAudit = auditBlogLinkQuotas(contentStr);
  if (!linkAudit.ok) {
    return linkAudit;
  }

  return { ok: true };
}

/** Run SEO audit against a BlogPost document (publish gatekeeper). */
function auditBlogPostDocument(post, { siteName = 'Bazaar' } = {}) {
  if (!post) {
    return { ok: false, message: 'SEO Audit Failed: Blog post not found.' };
  }

  const title = String(post.title || '').trim();
  const metaTitle = String(
    post.metaTitle || (title ? `${title} | ${siteName}` : '')
  ).trim();

  return runBlogContentAudit({
    title,
    metaTitle,
    summary: String(post.metaDescription || post.description || '').trim(),
    content: String(post.body || '').trim()
  });
}

module.exports = { runBlogContentAudit, auditBlogPostDocument, normalizeBlogHtml };
