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
const { resolveBlogShopDestination } = require('../lib/blogShopLink');

/** Free-tier friendly instruct model on Hugging Face Inference Providers. */
const DEFAULT_MODEL =
  process.env.HUGGINGFACE_BLOG_MODEL || 'Qwen/Qwen2.5-7B-Instruct';

function getHfClient() {
  const key = String(process.env.HUGGINGFACE_API_KEY || '').trim();
  if (!key) return null;
  return new InferenceClient(key);
}

/** Admin diagnostics — never exposes the full API key. */
function getAiBlogConfigStatus() {
  const key = String(process.env.HUGGINGFACE_API_KEY || '').trim();
  return {
    configured: key.length > 0,
    model: DEFAULT_MODEL,
    envVar: 'HUGGINGFACE_API_KEY'
  };
}

function buildSeoPrompt() {
  const siteName = getSiteName();
  const origin = getSiteOrigin();
  const now = new Date();
  const monthYear = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  return `Identify a hot grocery, cooking, or lifestyle trend in Pakistan for ${monthYear} and generate a fully audited blog draft for "${siteName}" (${origin}).

You MUST strictly follow this Content Audit Checklist:

1. KEYWORD & NLP RULES:
- Choose a clear Primary Keyword. It must appear in "title", "summary" (within first 155 chars), and within the first 100 words of "content".
- Use the Primary Keyword naturally in 2 to 3 <h2> headings. Do NOT stuff keywords. No back-to-back repetition.
- First paragraph must include 2-3 lines of solution-based sentences.
- Optimize for high Google NLP Score (0.7 - 0.9) by keeping transactional/informational intent laser-focused on home shopping.

2. STRUCTURE & HEADINGS RULES:
- Output format MUST be strictly HTML inside the JSON "content" string.
- Do NOT include <h1> in "content" — the page H1 comes from "title" only.
- Use logical <h2> sections covering exactly: Overview, Cost/Price Breakdown Ranges, Product Comparisons, and Buyer Types/Real-life Household Examples.
- Include a dedicated "FAQs" section as an <h2> at the end with exactly 4 to 5 frequently asked questions. Each FAQ answer must be 3-5 lines max, helpful, and neutral.
- Use <h3> only for sub-explanations. Paragraphs must be short: 2 to 4 lines max using simple, professional English (active voice).

3. TABLES & BULLET POINTS:
- Include exactly one structural HTML <table> comparing grocery options or budget vs premium tier choices to support the business angle.
- Use bullet points (<ul> and <li>) naturally for quick takeaways.

4. FACTUAL & ECOMMERCE PROTECTION RULES:
- Never use exact fixed prices. Always use realistic Pakistani Rupee (Rs.) ranges.
- Avoid clickbait promises like "cheap", "best", "guaranteed". Content must feel safe, informative, and expert-written.
- Focus on convenience, delivery speed, and time-saving aspects of ordering online.
- Include at least two internal links with site-relative URLs: href="/shop" and href="/shop?category=..." matching the topic.

The response must be strictly a valid, raw JSON object without markdown formatting blocks (NO \`\`\`json wrappers), containing exactly these keys:
{
  "title": "Catchy title under 60 chars matching checklist rules",
  "slug": "url-safe-string",
  "summary": "Meta description under 155 chars starting with primary keyword",
  "primaryKeyword": "The main target keyword phrase",
  "category": "One of: Care, Tech, Home, Fashion, Beauty, Lifestyle, Shopping",
  "content": "Full semantic HTML body with <h2>, <h3>, <p>, <strong>, <ul>, and <table> — no <h1>",
  "tags": ["tag1", "tag2", "tag3"],
  "destinationLabel": "Real shop category name only (e.g. Cleaning & Homecare) — do NOT prefix with Shop",
  "destinationUrl": "Optional hint only — server picks a live category with products"
}`;
}

async function requestBlogJsonFromHf(client) {
  const response = await client.chatCompletion({
    model: DEFAULT_MODEL,
    messages: [
      {
        role: 'system',
        content:
          'You are an Elite E-commerce SEO Specialist aligned with Google Search Central 2026 Helpful Content & E-E-A-T guidelines. Output only valid JSON matching the user schema. No markdown fences, no commentary, no extra keys.'
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
  const tags = mapTags(rawJson.tags);
  const primaryKeyword = String(rawJson.primaryKeyword || tags[0] || '').trim();

  const shopDest = await resolveBlogShopDestination({
    blogCategory: category,
    tags,
    primaryKeyword,
    currentLabel: rawJson.destinationLabel,
    currentUrl: rawJson.destinationUrl
  });

  const contentHtml = ensureInternalShopLinks(
    String(rawJson.content || ''),
    shopDest.destinationUrl
  );
  const sections = extractSectionsFromHtml(contentHtml);
  const summary = String(rawJson.summary || '').trim().slice(0, 320);
  const title = String(rawJson.title || '').trim().slice(0, 200);
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
    destinationLabel: shopDest.destinationLabel,
    destinationUrl: shopDest.destinationUrl,
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

module.exports = { autoGenerateTrendingBlog, buildSeoPrompt, getAiBlogConfigStatus };
