/**
 * Build sitemap XML from catalog entries (DB or build-time API).
 */
const Product = require('../models/Product');
const Category = require('../models/Category');
const Brand = require('../models/Brand');
const BlogPost = require('../models/BlogPost');
const { activeCategoryIds } = require('./activeCategories');
const { productHasImageMongoMatch } = require('./productImageFilter');
const { isBlockedBrand } = require('./brandFilters');
const {
  STATIC_ROUTES,
  normalizeSiteUrl,
  buildProductPath,
  buildCategoryPath,
  buildBrandPath,
  buildBlogPath,
  absoluteUrl
} = require('./sitemapPaths');

const MAX_URLS_PER_SITEMAP = 4500;

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatLastmod(value) {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

function addEntry(map, entry) {
  if (!entry?.loc) return;
  const key = entry.loc;
  const existing = map.get(key);
  if (!existing) {
    map.set(key, entry);
    return;
  }
  if (entry.lastmod && (!existing.lastmod || entry.lastmod > existing.lastmod)) {
    map.set(key, { ...existing, ...entry });
  }
}

/**
 * @param {string} siteUrl
 * @param {object} catalog
 */
function buildSitemapEntriesFromCatalog(siteUrl, catalog = {}) {
  const base = normalizeSiteUrl(siteUrl);
  const map = new Map();
  const now = formatLastmod(new Date());

  for (const route of STATIC_ROUTES) {
    addEntry(map, {
      loc: absoluteUrl(base, route.path),
      changefreq: route.changefreq,
      priority: route.priority,
      lastmod: now
    });
  }

  for (const category of catalog.categories || []) {
    const path = buildCategoryPath(category.slug || category.name);
    if (!path) continue;
    addEntry(map, {
      loc: absoluteUrl(base, path),
      changefreq: 'weekly',
      priority: '0.85',
      lastmod: formatLastmod(category.updatedAt) || now
    });
  }

  for (const product of catalog.products || []) {
    const path = buildProductPath(product);
    if (!path) continue;
    addEntry(map, {
      loc: absoluteUrl(base, path),
      changefreq: 'weekly',
      priority: '0.8',
      lastmod: formatLastmod(product.updatedAt || product.createdAt) || now
    });
  }

  for (const brand of catalog.brands || []) {
    if (brand.isActive === false || isBlockedBrand(brand)) continue;
    const path = buildBrandPath(brand.slug);
    if (!path) continue;
    addEntry(map, {
      loc: absoluteUrl(base, path),
      changefreq: 'weekly',
      priority: '0.65',
      lastmod: formatLastmod(brand.updatedAt) || now
    });
  }

  for (const post of catalog.blogPosts || []) {
    if (post.status === 'draft') continue;
    const path = buildBlogPath(post.slug);
    if (!path) continue;
    addEntry(map, {
      loc: absoluteUrl(base, path),
      changefreq: 'monthly',
      priority: '0.6',
      lastmod: formatLastmod(post.updatedAt || post.dateISO) || now
    });
  }

  return Array.from(map.values()).sort((a, b) => a.loc.localeCompare(b.loc));
}

/**
 * Load published catalog from MongoDB.
 * @param {string} [siteUrl]
 */
async function collectSitemapEntriesFromDb(siteUrl) {
  const base = normalizeSiteUrl(siteUrl || process.env.FRONTEND_URL || 'https://www.bazaar-pk.com');
  const categoryIds = await activeCategoryIds();

  const [categories, products, brands, blogPosts] = await Promise.all([
    Category.find({ isActive: true }).select('slug name updatedAt').lean(),
    Product.find({
      isPublished: true,
      category: { $in: categoryIds },
      ...productHasImageMongoMatch()
    })
      .select('slug name updatedAt createdAt category')
      .populate('category', 'slug')
      .lean(),
    Brand.find({ isActive: true }).select('slug name updatedAt isActive image imageUrl').lean(),
    BlogPost.find({ status: 'published' }).select('slug updatedAt dateISO status').lean()
  ]);

  return buildSitemapEntriesFromCatalog(base, {
    categories,
    products,
    brands,
    blogPosts
  });
}

function renderUrlTag(entry) {
  const parts = [`    <url>`, `      <loc>${escapeXml(entry.loc)}</loc>`];
  if (entry.lastmod) parts.push(`      <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
  if (entry.changefreq) parts.push(`      <changefreq>${escapeXml(entry.changefreq)}</changefreq>`);
  if (entry.priority) parts.push(`      <priority>${escapeXml(entry.priority)}</priority>`);
  parts.push('    </url>');
  return parts.join('\n');
}

/**
 * @param {Array<object>} entries
 */
function renderSitemapXml(entries) {
  const body = (entries || []).map(renderUrlTag).join('\n');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `${body}\n` +
    '</urlset>\n'
  );
}

function renderSitemapIndexXml(sitemaps) {
  const body = (sitemaps || [])
    .map((row) => {
      const lines = [`    <sitemap>`, `      <loc>${escapeXml(row.loc)}</loc>`];
      if (row.lastmod) lines.push(`      <lastmod>${escapeXml(row.lastmod)}</lastmod>`);
      lines.push('    </sitemap>');
      return lines.join('\n');
    })
    .join('\n');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `${body}\n` +
    '</sitemapindex>\n'
  );
}

/**
 * Split large catalogs into chunked sitemap files.
 * @param {string} siteUrl
 * @param {Array<object>} entries
 */
function buildSitemapChunks(siteUrl, entries) {
  const base = normalizeSiteUrl(siteUrl);
  const list = entries || [];
  if (list.length <= MAX_URLS_PER_SITEMAP) {
    return [{ filename: 'sitemap.xml', entries: list }];
  }

  const chunks = [];
  for (let i = 0; i < list.length; i += MAX_URLS_PER_SITEMAP) {
    const index = Math.floor(i / MAX_URLS_PER_SITEMAP) + 1;
    chunks.push({
      filename: `sitemap-products-${index}.xml`,
      entries: list.slice(i, i + MAX_URLS_PER_SITEMAP)
    });
  }
  return chunks;
}

function buildSitemapIndexEntries(siteUrl, chunkFiles) {
  const base = normalizeSiteUrl(siteUrl);
  const lastmod = formatLastmod(new Date());
  return chunkFiles.map((file) => ({
    loc: absoluteUrl(base, `/${file}`),
    lastmod
  }));
}

module.exports = {
  MAX_URLS_PER_SITEMAP,
  buildSitemapEntriesFromCatalog,
  collectSitemapEntriesFromDb,
  renderSitemapXml,
  renderSitemapIndexXml,
  buildSitemapChunks,
  buildSitemapIndexEntries,
  formatLastmod
};
