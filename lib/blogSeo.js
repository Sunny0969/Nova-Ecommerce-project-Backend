/**
 * Blog SEO helpers — Google Search Central aligned schema + HTML utilities.
 */

const DEFAULT_SITE_NAME = 'Bazaar';
const DEFAULT_SITE_ORIGIN = 'https://www.bazaar-pk.com';

const CATEGORY_IMAGES = {
  Care: 'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?w=1200&auto=format&fit=crop&q=80',
  Tech: 'https://images.unsplash.com/photo-1498049794561-7780e7231661?w=1200&auto=format&fit=crop&q=80',
  Home: 'https://images.unsplash.com/photo-1484101403633-562f891dc89a?w=1200&auto=format&fit=crop&q=80',
  Fashion: 'https://images.unsplash.com/photo-1445205170230-053b83016050?w=1200&auto=format&fit=crop&q=80',
  Beauty: 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=1200&auto=format&fit=crop&q=80',
  Lifestyle: 'https://images.unsplash.com/photo-1522204523234-8729aa6e3d5f?w=1200&auto=format&fit=crop&q=80',
  Shopping: 'https://images.unsplash.com/photo-1561767655-2e0cad0408c7?w=1200&auto=format&fit=crop&q=80'
};

function normalizeSlug(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function getSiteOrigin() {
  const fromEnv = String(process.env.FRONTEND_URL || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean)[0];
  return fromEnv || DEFAULT_SITE_ORIGIN;
}

function getSiteName() {
  return String(process.env.SITE_NAME || DEFAULT_SITE_NAME).trim() || DEFAULT_SITE_NAME;
}

function estimateReadingMinutes(htmlOrText) {
  const text = String(htmlOrText || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = text ? text.split(' ').length : 0;
  return Math.min(20, Math.max(4, Math.ceil(words / 200) || 5));
}

function parseJsonFromModel(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('Empty AI response');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonStr = fenced ? fenced[1].trim() : raw;
  return JSON.parse(jsonStr);
}

function stripDangerousHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<h1[\s\S]*?<\/h1>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

/** Ensure at least one contextual link to the shop catalog. */
function ensureInternalShopLinks(html, shopPath = '/shop') {
  let out = stripDangerousHtml(html);
  if (!out.trim()) return out;
  if (out.includes('href="/shop') || out.includes("href='/shop")) {
    return out;
  }
  const siteName = getSiteName();
  out += `\n<p><strong>Shop now:</strong> Browse curated products in our <a href="${shopPath}">${siteName} online store</a> — fast delivery across Pakistan.</p>`;
  return out;
}

/** Parse H2 blocks into structured sections for TOC (frontend fallback). */
function extractSectionsFromHtml(html) {
  const clean = stripDangerousHtml(html);
  const sections = [];
  const parts = clean.split(/<h2[^>]*>/i);
  if (parts.length <= 1) return sections;

  for (let i = 1; i < parts.length; i += 1) {
    const chunk = parts[i];
    const titleEnd = chunk.indexOf('</h2>');
    if (titleEnd === -1) continue;
    const title = chunk
      .slice(0, titleEnd)
      .replace(/<[^>]+>/g, '')
      .trim();
    const content = chunk
      .slice(titleEnd + 5)
      .replace(/<h3[^>]*>/gi, '')
      .replace(/<\/h3>/gi, ' — ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (title) sections.push({ title, content });
  }
  return sections;
}

function buildBlogPostingSchema({
  title,
  summary,
  slug,
  featuredImage,
  datePublished,
  canonicalUrl
}) {
  const origin = getSiteOrigin();
  const siteName = getSiteName();
  const pageUrl = canonicalUrl || `${origin}/blog/${encodeURIComponent(slug)}`;
  const image =
    featuredImage && String(featuredImage).trim()
      ? String(featuredImage).trim()
      : undefined;

  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: String(title || '').trim(),
    description: String(summary || '').trim(),
    image: image ? [image] : undefined,
    author: {
      '@type': 'Organization',
      name: `${siteName} Editorial Team`,
      url: origin
    },
    publisher: {
      '@type': 'Organization',
      name: siteName,
      url: origin
    },
    inLanguage: 'en-PK',
    datePublished: datePublished || new Date().toISOString(),
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': pageUrl
    }
  };
}

function defaultFeaturedImage(category) {
  const cat = String(category || '').trim();
  return CATEGORY_IMAGES[cat] || CATEGORY_IMAGES.Shopping;
}

function mapTags(rawTags) {
  if (!Array.isArray(rawTags)) return [];
  return rawTags.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 6);
}

module.exports = {
  normalizeSlug,
  getSiteOrigin,
  getSiteName,
  estimateReadingMinutes,
  parseJsonFromModel,
  stripDangerousHtml,
  ensureInternalShopLinks,
  extractSectionsFromHtml,
  buildBlogPostingSchema,
  defaultFeaturedImage,
  mapTags
};
