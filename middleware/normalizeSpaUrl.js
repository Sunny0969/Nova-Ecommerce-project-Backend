const path = require('path');

const STATIC_EXT = new Set([
  '.html',
  '.htm',
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.map',
  '.json',
  '.ico',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.txt',
  '.xml',
  '.webmanifest'
]);

/**
 * 301 canonical URLs for SPA paths served from this Express host:
 * - /products → /shop, /products/ → /shop
 * - /product/:slug → /shop/:slug (slug lowercased)
 * - Any path lowercased
 * - Trailing slash removed (except /)
 * Skips /api/* and typical static file extensions.
 */
function normalizeSpaUrl(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();

  const pathname = req.path || '/';
  if (pathname.startsWith('/api')) return next();

  const base = path.basename(pathname);
  const ext = base.includes('.') ? path.extname(base).toLowerCase() : '';
  if (ext && STATIC_EXT.has(ext)) return next();

  const q = req.url && req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';

  let target = pathname;

  const productLegacy = pathname.match(/^\/product\/([^/]+)\/?$/i);
  if (productLegacy) {
    const seg = String(productLegacy[1] || '').trim();
    if (!seg) return next();
    target = `/shop/${seg.toLowerCase()}`;
  } else if (/^\/products\/?$/i.test(pathname)) {
    target = '/shop';
  } else {
    target = pathname.toLowerCase();
    if (target.length > 1 && target.endsWith('/')) {
      target = target.slice(0, -1);
    }
  }

  if (target === pathname) return next();
  return res.redirect(301, target + q);
}

module.exports = normalizeSpaUrl;
