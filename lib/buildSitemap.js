const Product = require('../models/Product');
const Category = require('../models/Category');
const Brand = require('../models/Brand');
const BlogPost = require('../models/BlogPost');
const { publicSiteUrl } = require('./publicSiteUrl');
const { getCleanProductSlug } = require('./productDescription');

/** Slugs that are app routes, not category listing URLs */
const RESERVED_CATEGORY_SLUGS = new Set([
  'home',
  'shop',
  'login',
  'register',
  'forgot-password',
  'reset-password',
  'verify-email',
  'cart',
  'checkout',
  'order-confirmation',
  'account',
  'orders',
  'wishlist',
  'blog',
  'brands',
  'brand',
  'products',
  'product',
  'category',
  'about-us',
  'privacy-policy',
  'contact-us',
  'faqs',
  'terms-and-conditions',
  'admin',
  'staff',
  'api'
]);

function isReservedCategorySlug(slug) {
  return RESERVED_CATEGORY_SLUGS.has(String(slug || '').trim().toLowerCase());
}

const STATIC_PAGES = [
  { path: '/', changefreq: 'daily', priority: '1.0' },
  { path: '/shop', changefreq: 'daily', priority: '0.9' },
  { path: '/blog', changefreq: 'weekly', priority: '0.7' },
  { path: '/brands', changefreq: 'weekly', priority: '0.7' },
  { path: '/about-us', changefreq: 'monthly', priority: '0.5' },
  { path: '/contact-us', changefreq: 'monthly', priority: '0.5' },
  { path: '/privacy-policy', changefreq: 'yearly', priority: '0.3' },
  { path: '/terms-and-conditions', changefreq: 'yearly', priority: '0.3' },
  { path: '/faqs', changefreq: 'monthly', priority: '0.5' },
  { path: '/returns-and-refunds', changefreq: 'yearly', priority: '0.3' },
  { path: '/shipping-policy', changefreq: 'yearly', priority: '0.3' }
];

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toIsoDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function isValidSlug(slug) {
  const s = String(slug || '').trim();
  if (!s || s.length > 120) return false;
  if (/imageurl|categoryflag|"\s*,\s*"/i.test(s)) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(s);
}

function urlEntry(base, path, { lastmod, changefreq = 'weekly', priority = '0.5' } = {}) {
  const loc = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  let xml = `  <url>\n    <loc>${escapeXml(loc)}</loc>`;
  if (lastmod) xml += `\n    <lastmod>${escapeXml(lastmod)}</lastmod>`;
  if (changefreq) xml += `\n    <changefreq>${escapeXml(changefreq)}</changefreq>`;
  if (priority) xml += `\n    <priority>${escapeXml(priority)}</priority>`;
  xml += '\n  </url>';
  return xml;
}

async function collectSitemapEntries(siteUrl = publicSiteUrl()) {
  const base = String(siteUrl || 'https://www.bazaar-pk.com').replace(/\/+$/, '');
  const entries = [];

  for (const page of STATIC_PAGES) {
    entries.push(urlEntry(base, page.path, {
      changefreq: page.changefreq,
      priority: page.priority,
      lastmod: toIsoDate(new Date())
    }));
  }

  const [products, categories, brands, posts] = await Promise.all([
    Product.find({
      isPublished: true,
      slug: { $exists: true, $nin: [null, ''] }
    })
      .populate('category', 'slug isActive')
      .select('slug name updatedAt category')
      .lean(),
    Category.find({ isActive: true })
      .select('slug updatedAt')
      .lean(),
    Brand.find({ isActive: { $ne: false } })
      .select('slug updatedAt')
      .lean(),
    BlogPost.find({ status: 'published' })
      .select('slug updatedAt')
      .lean()
  ]);

  const seenPaths = new Set(STATIC_PAGES.map((p) => p.path));

  for (const product of products) {
    const catObj =
      typeof product.category === 'object' && product.category != null ? product.category : null;
    if (catObj && catObj.isActive === false) continue;

    const slug = getCleanProductSlug(product);
    if (!isValidSlug(slug)) continue;
    const cat =
      typeof product.category === 'object' && product.category?.slug
        ? String(product.category.slug).trim()
        : typeof product.category === 'string'
          ? String(product.category).trim()
          : '';
    const path =
      cat && isValidSlug(cat) && !isReservedCategorySlug(cat)
        ? `/${cat}/${slug}`
        : `/shop/${slug}`;
    if (seenPaths.has(path)) continue;
    seenPaths.add(path);
    entries.push(
      urlEntry(base, path, {
        lastmod: toIsoDate(product.updatedAt),
        changefreq: 'weekly',
        priority: '0.8'
      })
    );
  }

  for (const category of categories) {
    const slug = String(category.slug || '').trim();
    if (!isValidSlug(slug) || isReservedCategorySlug(slug)) continue;
    const path = `/${slug}`;
    if (seenPaths.has(path)) continue;
    seenPaths.add(path);
    entries.push(
      urlEntry(base, path, {
        lastmod: toIsoDate(category.updatedAt),
        changefreq: 'weekly',
        priority: '0.7'
      })
    );
  }

  for (const brand of brands) {
    const slug = String(brand.slug || '').trim();
    if (!isValidSlug(slug)) continue;
    const path = `/brand/${slug}`;
    if (seenPaths.has(path)) continue;
    seenPaths.add(path);
    entries.push(
      urlEntry(base, path, {
        lastmod: toIsoDate(brand.updatedAt),
        changefreq: 'weekly',
        priority: '0.6'
      })
    );
  }

  for (const post of posts) {
    const slug = String(post.slug || '').trim();
    if (!isValidSlug(slug)) continue;
    const path = `/blog/${slug}`;
    if (seenPaths.has(path)) continue;
    seenPaths.add(path);
    entries.push(
      urlEntry(base, path, {
        lastmod: toIsoDate(post.updatedAt),
        changefreq: 'monthly',
        priority: '0.6'
      })
    );
  }

  return entries;
}

async function buildSitemapXml(siteUrl = publicSiteUrl()) {
  const entries = await collectSitemapEntries(siteUrl);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    '</urlset>'
  ].join('\n');
}

module.exports = {
  STATIC_PAGES,
  buildSitemapXml,
  collectSitemapEntries
};
