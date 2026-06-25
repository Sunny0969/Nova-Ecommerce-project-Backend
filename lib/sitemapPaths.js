/**
 * Canonical URL paths for sitemap (must match prerender / React Router).
 */
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
  'returns-and-refunds',
  'shipping-policy',
  'admin',
  'staff',
  'api',
  'static'
]);

const STATIC_ROUTES = [
  { path: '/', changefreq: 'daily', priority: '1.0' },
  { path: '/shop', changefreq: 'daily', priority: '0.9' },
  { path: '/blog', changefreq: 'weekly', priority: '0.7' },
  { path: '/brands', changefreq: 'weekly', priority: '0.7' },
  { path: '/about-us', changefreq: 'monthly', priority: '0.5' },
  { path: '/contact-us', changefreq: 'monthly', priority: '0.5' },
  { path: '/faqs', changefreq: 'monthly', priority: '0.5' },
  { path: '/privacy-policy', changefreq: 'yearly', priority: '0.3' },
  { path: '/terms-and-conditions', changefreq: 'yearly', priority: '0.3' },
  { path: '/returns-and-refunds', changefreq: 'yearly', priority: '0.3' },
  { path: '/shipping-policy', changefreq: 'yearly', priority: '0.3' }
];

function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeSiteUrl(url) {
  return String(url || 'https://www.bazaar-pk.com')
    .trim()
    .replace(/\/+$/, '');
}

function productCategorySlug(product) {
  if (product?.categorySlug) return normalizeSlug(product.categorySlug);
  const c = product?.category;
  if (c && typeof c === 'object' && c.slug) return normalizeSlug(c.slug);
  if (typeof c === 'string') return normalizeSlug(c);
  return '';
}

function buildProductPath(product) {
  const slug = normalizeSlug(product?.slug) || normalizeSlug(product?.name);
  const cat = productCategorySlug(product);
  if (slug && cat && !RESERVED_CATEGORY_SLUGS.has(cat)) {
    return `/${encodeURIComponent(cat)}/${encodeURIComponent(slug)}`;
  }
  if (slug) return `/shop/${encodeURIComponent(slug)}`;
  return null;
}

function buildCategoryPath(slug) {
  const s = normalizeSlug(slug);
  if (!s || RESERVED_CATEGORY_SLUGS.has(s)) return null;
  return `/${encodeURIComponent(s)}`;
}

function buildBrandPath(slug) {
  const s = normalizeSlug(slug);
  if (!s) return null;
  return `/brand/${encodeURIComponent(s)}`;
}

function buildBlogPath(slug) {
  const s = normalizeSlug(slug);
  if (!s) return null;
  return `/blog/${encodeURIComponent(s)}`;
}

function absoluteUrl(siteUrl, routePath) {
  const base = normalizeSiteUrl(siteUrl);
  const path = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return `${base}${path}`;
}

module.exports = {
  RESERVED_CATEGORY_SLUGS,
  STATIC_ROUTES,
  normalizeSlug,
  normalizeSiteUrl,
  buildProductPath,
  buildCategoryPath,
  buildBrandPath,
  buildBlogPath,
  absoluteUrl
};
