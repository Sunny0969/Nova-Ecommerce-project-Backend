/**
 * Resolve a real shop category (with published products) for blog CTAs.
 */
const Category = require('../models/Category');
const Product = require('../models/Product');
const BlogPost = require('../models/BlogPost');
const { productHasImageMongoMatch } = require('./productImageFilter');
const { shapeProductListItem } = require('./productListShape');

/** Blog editorial category → preferred shop category slugs (first match with products wins). */
const BLOG_CATEGORY_HINTS = {
  Care: ['personal-care', 'hair-care', 'cleaning-homecare', 'laundry', 'pet-care'],
  Home: ['cleaning-homecare', 'laundry', 'jar-canned-foods', 'oil-ghee', 'pasta-noodles'],
  Fashion: ['clothing', 'blue-pottery'],
  Beauty: ['personal-care', 'hair-care'],
  Lifestyle: ['beverages', 'snacks', 'pasta-noodles', 'pulses', 'milk-dairy'],
  Tech: ['electronics', 'personal-care'],
  Shopping: ['beverages', 'snacks', 'cleaning-homecare', 'personal-care', 'clothing']
};

const FALLBACK_SHOP_SLUGS = [
  'cleaning-homecare',
  'personal-care',
  'beverages',
  'snacks',
  'clothing',
  'laundry',
  'hair-care',
  'oil-ghee',
  'pasta-noodles',
  'jar-canned-foods'
];

function normalizeSlug(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function cleanDestinationLabel(label) {
  let s = String(label || '').trim();
  if (!s) return '';
  s = s.replace(/^shop\s+/i, '').trim();
  if (/^shop\s*now$/i.test(s)) return '';
  return s;
}

function extractSlugFromDestinationUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/shop')) {
    try {
      const q = raw.includes('?') ? raw.split('?')[1] : '';
      const params = new URLSearchParams(q);
      const cat = params.get('category');
      if (cat) return normalizeSlug(cat);
    } catch {
      /* ignore */
    }
    return '';
  }
  const path = raw.split('?')[0].replace(/^\/+/, '');
  const seg = path.split('/').filter(Boolean)[0];
  if (!seg || seg === 'shop' || seg === 'blog') return '';
  return normalizeSlug(seg);
}

function keywordHints(tags, primaryKeyword) {
  const terms = []
    .concat(Array.isArray(tags) ? tags : [])
    .concat(primaryKeyword ? [primaryKeyword] : [])
    .map((t) => normalizeSlug(t))
    .filter(Boolean);
  return terms;
}

async function countPublishedProducts(categoryId) {
  return Product.countDocuments({
    category: categoryId,
    isPublished: true,
    ...productHasImageMongoMatch()
  });
}

async function pickCategoryBySlugs(slugList) {
  const seen = new Set();
  for (const slug of slugList) {
    const s = normalizeSlug(slug);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    const cat = await Category.findOne({ slug: s, isActive: true })
      .select('_id name slug image')
      .lean();
    if (!cat) continue;
    const productCount = await countPublishedProducts(cat._id);
    if (productCount > 0) {
      return {
        slug: cat.slug,
        name: cat.name,
        productCount,
        imageUrl: cat.image?.url || ''
      };
    }
  }
  return null;
}

async function pickCategoryByKeywordTerms(terms) {
  if (!terms.length) return null;
  const categories = await Category.find({ isActive: true }).select('_id name slug image').lean();
  for (const term of terms) {
    const match = categories.find((c) => {
      const slug = normalizeSlug(c.slug);
      const name = normalizeSlug(c.name);
      return slug.includes(term) || term.includes(slug) || name.includes(term) || term.includes(name);
    });
    if (!match) continue;
    const productCount = await countPublishedProducts(match._id);
    if (productCount > 0) {
      return {
        slug: match.slug,
        name: match.name,
        productCount,
        imageUrl: match.image?.url || ''
      };
    }
  }
  return null;
}

/**
 * Pick the best shop category that actually has products.
 */
async function resolveBlogShopDestination({
  blogCategory,
  tags,
  primaryKeyword,
  currentLabel,
  currentUrl
}) {
  const hints = [
    extractSlugFromDestinationUrl(currentUrl),
    ...(BLOG_CATEGORY_HINTS[String(blogCategory || '').trim()] || []),
    ...keywordHints(tags, primaryKeyword),
    ...FALLBACK_SHOP_SLUGS
  ];

  let picked =
    (await pickCategoryBySlugs(hints)) ||
    (await pickCategoryByKeywordTerms(keywordHints(tags, primaryKeyword)));

  if (!picked) {
    return {
      destinationLabel: 'All Products',
      destinationUrl: '/shop',
      shopCategorySlug: '',
      productCount: 0,
      imageUrl: ''
    };
  }

  const label = cleanDestinationLabel(currentLabel) || picked.name;
  return {
    destinationLabel: label,
    destinationUrl: `/${picked.slug}`,
    shopCategorySlug: picked.slug,
    productCount: picked.productCount,
    imageUrl: picked.imageUrl
  };
}

async function fetchCategoryProductPreview(categorySlug, limit = 4) {
  const slug = normalizeSlug(categorySlug);
  if (!slug) return [];
  const cat = await Category.findOne({ slug, isActive: true }).select('_id').lean();
  if (!cat) return [];

  const rows = await Product.find({
    category: cat._id,
    isPublished: true,
    ...productHasImageMongoMatch()
  })
    .select('name slug price images category comparePrice originalPrice tags badge ratings stock')
    .populate('category', 'name slug')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return rows.map(shapeProductListItem);
}

/**
 * Attach shop category + product preview; optionally persist fixed destination fields.
 */
async function enrichBlogPost(post, { persistFix = true } = {}) {
  if (!post) return post;

  const resolved = await resolveBlogShopDestination({
    blogCategory: post.category,
    tags: post.tags,
    primaryKeyword: post.primaryKeyword,
    currentLabel: post.destinationLabel,
    currentUrl: post.destinationUrl
  });

  const products = resolved.shopCategorySlug
    ? await fetchCategoryProductPreview(resolved.shopCategorySlug, 4)
    : [];

  const relatedPosts = await BlogPost.find({
    status: 'published',
    slug: { $ne: post.slug }
  })
    .sort({ dateISO: -1 })
    .limit(4)
    .select('title slug featuredImage category dateISO tag readingMinutes description metaDescription')
    .lean();

  const metaDescription = String(post.metaDescription || post.description || '').trim();

  const shouldPersist =
    persistFix &&
    post._id &&
    (post.destinationUrl !== resolved.destinationUrl ||
      cleanDestinationLabel(post.destinationLabel) !== resolved.destinationLabel);

  if (shouldPersist) {
    void BlogPostUpdateDestination(post._id, resolved);
  }

  return {
    ...post,
    metaDescription,
    description: metaDescription || post.description,
    destinationLabel: resolved.destinationLabel,
    destinationUrl: resolved.destinationUrl,
    shopCategory: {
      slug: resolved.shopCategorySlug,
      name: resolved.destinationLabel,
      productCount: resolved.productCount,
      imageUrl: resolved.imageUrl,
      products
    },
    relatedPosts
  };
}

async function BlogPostUpdateDestination(id, resolved) {
  try {
    await BlogPost.findByIdAndUpdate(id, {
      destinationLabel: resolved.destinationLabel,
      destinationUrl: resolved.destinationUrl
    });
  } catch (err) {
    console.warn('[blog-shop-link] Could not persist destination fix:', err.message);
  }
}

module.exports = {
  resolveBlogShopDestination,
  enrichBlogPost,
  fetchCategoryProductPreview,
  cleanDestinationLabel
};
