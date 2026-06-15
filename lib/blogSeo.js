/**
 * Blog SEO helpers — Google Search Central aligned schema + HTML utilities.
 */

const DEFAULT_SITE_NAME = 'Bazaar';
const DEFAULT_SITE_ORIGIN = 'https://www.bazaar-pk.com';

/** Minimum words in AI-generated blog HTML body (plain text, tags stripped). */
const MIN_BLOG_WORDS = Number(process.env.AI_BLOG_MIN_WORDS || 1500);

const UNSPLASH_BASE = 'https://images.unsplash.com';

/** Curated unique featured images — grocery, lifestyle, home, shopping (Pakistan-relevant). */
const BLOG_IMAGE_POOL = [
  `${UNSPLASH_BASE}/photo-1542838132-92c53300491e?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1556910103-1c02745aae4d?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1512621776951-a57141f2eefd?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1464226184884-fa280b87c0d2?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1498837167922-ddd27525b705?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1488459716781-31db52582fe9?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1578916171728-46686eac8d58?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1604719312566-8912a0866b64?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1586201375761-83865001e31c?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1595855759250-8658869c2529?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1615485290388-2a4f2a1b4c8a?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1565299624946-bf28a0d4a3a0?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1504674900247-0877df9cc836?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1490645935967-10de803ba81a?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1511690743698-dcad21f86d38?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1556228578-0d85b1a4d571?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1498049794561-7780e7231661?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1484101403633-562f891dc89a?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1445205170230-053b83016050?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1522335789203-aabd1fc54bc9?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1561767655-2e0cad0408c7?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1528701800489-20be3c44c7a7?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1610891206177-4b8a0e4c7a4b?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1530103862676-de8c9de5771f?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1607082348824-0a96f2a4b9da?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1584464491033-06628f3a6b7b?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1610348728811-84380ea059ec?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1571171637578-41bc2dd41cd2?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1606787376850-82f7e49b82a5?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1558618666-fcd25c85cd64?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1625246333195-78d9c38ad449?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1593113598331-cf288581d043?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1600880292203-757bb62b4baf?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1556742049-0cfed4f6a45d?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1471194403329-6e7a0d6e9a6b?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1542601906990-b4d3fb778b09?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1607083206869-4c7dbe0811a1?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1616594039964-ae9023a8006c?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1586880242356-c97ddeb49503?w=1200&auto=format&fit=crop&q=80`,
  `${UNSPLASH_BASE}/photo-1512436991641-6745cdb1723f?w=1200&auto=format&fit=crop&q=80`
];

const CATEGORY_IMAGES = {
  Care: BLOG_IMAGE_POOL[15],
  Tech: BLOG_IMAGE_POOL[16],
  Home: BLOG_IMAGE_POOL[17],
  Fashion: BLOG_IMAGE_POOL[18],
  Beauty: BLOG_IMAGE_POOL[19],
  Lifestyle: BLOG_IMAGE_POOL[0],
  Shopping: BLOG_IMAGE_POOL[20]
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

function countWordsInHtml(htmlOrText) {
  const text = String(htmlOrText || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.split(' ').filter(Boolean).length : 0;
}

function estimateReadingMinutes(htmlOrText) {
  const words = countWordsInHtml(htmlOrText);
  return Math.min(30, Math.max(4, Math.ceil(words / 200) || 5));
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

function hashString(input) {
  let hash = 5381;
  const str = String(input || '');
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

function pickFeaturedImageFromPool({ slug, category, primaryKeyword, excludeUrls = new Set() }) {
  const seed = [slug, primaryKeyword, category].filter(Boolean).join('|');
  const start = hashString(seed) % BLOG_IMAGE_POOL.length;

  for (let i = 0; i < BLOG_IMAGE_POOL.length; i += 1) {
    const url = BLOG_IMAGE_POOL[(start + i) % BLOG_IMAGE_POOL.length];
    if (!excludeUrls.has(url)) return url;
  }

  const fallback = BLOG_IMAGE_POOL[start];
  const sig = encodeURIComponent(String(slug || primaryKeyword || 'blog').slice(0, 40));
  return fallback.includes('?') ? `${fallback}&sig=${sig}` : `${fallback}?sig=${sig}`;
}

/**
 * Pick a featured image not already used by another blog post.
 */
async function pickUniqueFeaturedImage(BlogPostModel, { slug, category, primaryKeyword }) {
  const usedRows = await BlogPostModel.find({ featuredImage: { $ne: '' } })
    .select('featuredImage')
    .lean();
  const excludeUrls = new Set(
    usedRows.map((row) => String(row.featuredImage || '').trim()).filter(Boolean)
  );

  return pickFeaturedImageFromPool({ slug, category, primaryKeyword, excludeUrls });
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
  MIN_BLOG_WORDS,
  normalizeSlug,
  getSiteOrigin,
  getSiteName,
  countWordsInHtml,
  estimateReadingMinutes,
  parseJsonFromModel,
  stripDangerousHtml,
  ensureInternalShopLinks,
  extractSectionsFromHtml,
  buildBlogPostingSchema,
  defaultFeaturedImage,
  pickUniqueFeaturedImage,
  mapTags
};
