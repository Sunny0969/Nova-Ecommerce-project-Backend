const { InferenceClient } = require('@huggingface/inference');
const BlogPost = require('../models/BlogPost');
const {
  normalizeSlug,
  getSiteOrigin,
  getSiteName,
  estimateReadingMinutes,
  parseJsonFromModel,
  ensureInternalShopLinks,
  extractSectionsFromHtml,
  buildBlogPostingSchema,
  defaultFeaturedImage,
  mapTags
} = require('../lib/blogSeo');

/** Free-tier friendly instruct model on Hugging Face Inference Providers. */
const DEFAULT_MODEL =
  process.env.HUGGINGFACE_BLOG_MODEL || 'Qwen/Qwen2.5-7B-Instruct';

function getHfClient() {
  const key = String(process.env.HUGGINGFACE_API_KEY || '').trim();
  if (!key) return null;
  return new InferenceClient(key);
}

function buildSeoPrompt() {
  const siteName = getSiteName();
  const origin = getSiteOrigin();
  const year = new Date().getFullYear();

  return `Act as an Elite E-commerce SEO Specialist aligned with Google Search Central Guidelines.
Identify a high-volume, transactional or informational trending keyword for grocery, online shopping, home essentials, fashion, or lifestyle in Pakistan for ${year}.

Generate a ~1500-word highly engaging article for "${siteName}" (${origin}).
The response must be STRICTLY a JSON object with these exact keys:
1. "title": Catchy, click-worthy title under 60 characters.
2. "slug": Clean URL-safe string (lowercase, hyphens).
3. "summary": Compelling meta description under 155 characters; primary keyword in the first sentence.
4. "category": One of: Care, Tech, Home, Fashion, Beauty, Lifestyle, Shopping.
5. "primaryKeyword": The main target keyword phrase.
6. "content": Complete article body in semantic HTML ONLY (no <h1>). Use exactly one <h2> per main section, then <h3> for sub-points. Wrap paragraphs in <p>. Bold key takeaways with <strong>. Include one <ul><li> list for quick tips. Place the primary keyword naturally within the first 100 words. Include at least two internal links using site-relative URLs: href="/shop" and href="/shop?category=..." matching the topic. No keyword stuffing.
7. "tags": Array of 3-4 relevant search keywords.
8. "destinationLabel": Short CTA label for the related shop category (e.g. "Home Essentials").
9. "destinationUrl": Site-relative shop URL (e.g. "/shop" or "/shop?category=home").

Write with high EEAT (expert, helpful, human tone). Return JSON only — no markdown fences.`;
}

async function requestBlogJsonFromHf(client) {
  const response = await client.chatCompletion({
    model: DEFAULT_MODEL,
    messages: [
      {
        role: 'system',
        content:
          'You are a senior e-commerce SEO writer. Output only valid JSON matching the user schema. No markdown, no commentary.'
      },
      { role: 'user', content: buildSeoPrompt() }
    ],
    max_tokens: 8192,
    temperature: 0.65
  });

  const content = response?.choices?.[0]?.message?.content;
  if (!content || !String(content).trim()) {
    throw new Error('Hugging Face returned an empty response');
  }
  return parseJsonFromModel(content);
}

async function persistBlogDraft(rawJson) {
  const slugified = normalizeSlug(rawJson.slug || rawJson.title);
  if (!slugified) {
    return { created: false, reason: 'invalid_slug' };
  }

  const existingBlog = await BlogPost.findOne({ slug: slugified }).select('_id').lean();
  if (existingBlog) {
    console.log(`[AI-BLOG] Slug "${slugified}" already exists — skipped.`);
    return { created: false, reason: 'duplicate_slug' };
  }

  const category = String(rawJson.category || 'Shopping').trim() || 'Shopping';
  const contentHtml = ensureInternalShopLinks(String(rawJson.content || ''), '/shop');
  const sections = extractSectionsFromHtml(contentHtml);
  const tags = mapTags(rawJson.tags);
  const summary = String(rawJson.summary || '').trim().slice(0, 320);
  const title = String(rawJson.title || '').trim().slice(0, 200);
  const primaryKeyword = String(rawJson.primaryKeyword || tags[0] || '').trim();
  const featuredImage = defaultFeaturedImage(category);
  const dateISO = new Date();
  const canonicalUrl = `${getSiteOrigin()}/blog/${encodeURIComponent(slugified)}`;

  const schemaObject = buildBlogPostingSchema({
    title,
    summary,
    slug: slugified,
    featuredImage,
    datePublished: dateISO.toISOString(),
    canonicalUrl
  });

  const metaTitle = `${title} | ${getSiteName()}`.slice(0, 120);

  const newBlog = await BlogPost.create({
    title,
    slug: slugified,
    category,
    description: summary,
    metaTitle,
    metaDescription: summary,
    primaryKeyword,
    tag: tags[0] || 'Guide',
    tags,
    body: contentHtml,
    sections: sections.length ? sections : undefined,
    featuredImage,
    imageAlt: `${title} — ${getSiteName()} blog`,
    destinationLabel: String(rawJson.destinationLabel || 'Shop Online').trim() || 'Shop Online',
    destinationUrl: String(rawJson.destinationUrl || '/shop').trim() || '/shop',
    readingMinutes: estimateReadingMinutes(contentHtml),
    dateISO,
    status: 'draft',
    schemaMarkup: JSON.stringify(schemaObject)
  });

  console.log(`[AI-BLOG] Draft queued (HF): "${title}" (/blog/${slugified})`);
  return { created: true, post: newBlog.toObject() };
}

/**
 * Generate one SEO blog post via Hugging Face Inference API (free tier).
 * @returns {Promise<{ created: boolean, post?: object, reason?: string }>}
 */
async function autoGenerateTrendingBlog() {
  const client = getHfClient();
  if (!client) {
    console.warn('[AI-BLOG] HUGGINGFACE_API_KEY is not set — skipped.');
    return { created: false, reason: 'missing_hf_key' };
  }

  try {
    console.log(`[AI-BLOG] Generating draft via Hugging Face (${DEFAULT_MODEL})…`);
    const rawJson = await requestBlogJsonFromHf(client);
    return await persistBlogDraft(rawJson);
  } catch (error) {
    console.error('[AI-BLOG] Hugging Face generation error:', error.message);
    return { created: false, reason: error.message };
  }
}

module.exports = { autoGenerateTrendingBlog, buildSeoPrompt };
