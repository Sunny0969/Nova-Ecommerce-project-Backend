const path = require('path');
const express = require('express');

/** One year in seconds (365 × 24 × 60 × 60) — CRA hashed JS/CSS bundles. */
const CACHE_STATIC_MAX_AGE = 31_536_000;

/** Static assets with content-hashed filenames (JS/CSS) or long-lived media. */
const CACHE_STATIC_CONTROL = `public, max-age=${CACHE_STATIC_MAX_AGE}, immutable`;

/** HTML shell — always revalidate after deploy. */
const CACHE_HTML_CONTROL = 'no-cache, must-revalidate';

/** SEO / dynamic text on the API host (robots, sitemap). */
const CACHE_SEO_CONTROL = 'public, max-age=3600';

const STATIC_ASSET_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.svg',
  '.ico',
  '.gif',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.css',
  '.js',
  '.mjs',
  '.cjs',
  '.map',
  '.webmanifest'
]);

const NO_CACHE_BASENAMES = new Set([
  'index.html',
  'index.htm',
  'onesignalsdkworker.js',
  'service-worker.js',
  'sw.js'
]);

/**
 * Apply Cache-Control based on file path (Express static setHeaders).
 * @param {import('express').Response} res
 * @param {string} filePath
 */
function applyCacheControlForFile(res, filePath) {
  const base = path.basename(filePath);
  const ext = path.extname(base).toLowerCase();
  const baseLower = base.toLowerCase();

  if (NO_CACHE_BASENAMES.has(baseLower) || ext === '.html' || ext === '.htm') {
    res.setHeader('Cache-Control', CACHE_HTML_CONTROL);
    return;
  }

  if (STATIC_ASSET_EXT.has(ext)) {
    res.setHeader('Cache-Control', CACHE_STATIC_CONTROL);
  }
}

/**
 * Express static middleware with 1-year immutable cache for hashed assets and no-cache for HTML.
 * @param {string} rootDir Absolute path to static root (e.g. CRA `build/`).
 * @param {import('express').StaticOptions} [options]
 */
function createCachedStaticMiddleware(rootDir, options = {}) {
  const { setHeaders: userSetHeaders, ...rest } = options;

  return express.static(rootDir, {
    index: false,
    dotfiles: 'ignore',
    fallthrough: true,
    ...rest,
    setHeaders(res, filePath, stat) {
      applyCacheControlForFile(res, filePath);
      if (typeof userSetHeaders === 'function') {
        userSetHeaders(res, filePath, stat);
      }
    }
  });
}

/**
 * SPA fallback — serve index.html with no-cache (place after static + before API 404).
 * @param {string} indexPath Absolute path to index.html
 */
function createSpaFallbackHandler(indexPath) {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api')) return next();

    const ext = path.extname(req.path).toLowerCase();
    if (ext && STATIC_ASSET_EXT.has(ext)) return next();

    res.setHeader('Cache-Control', CACHE_HTML_CONTROL);
    res.sendFile(indexPath, (err) => {
      if (err) next(err);
    });
  };
}

module.exports = {
  CACHE_STATIC_MAX_AGE,
  CACHE_STATIC_CONTROL,
  CACHE_HTML_CONTROL,
  CACHE_SEO_CONTROL,
  STATIC_ASSET_EXT,
  applyCacheControlForFile,
  createCachedStaticMiddleware,
  createSpaFallbackHandler
};
