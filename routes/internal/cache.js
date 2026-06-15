const express = require('express');
const { flushAll } = require('../../lib/apiCache');
const { invalidateCatalogCache } = require('../../lib/invalidatePublicCache');

const router = express.Router();

/**
 * POST /api/internal/cache/flush — clear in-memory API cache (Railway / long-lived process).
 * Requires header X-Cache-Flush-Secret matching CACHE_FLUSH_SECRET in env.
 */
router.post('/flush', (req, res) => {
  const secret = String(process.env.CACHE_FLUSH_SECRET || '').trim();
  if (!secret) {
    return res.status(503).json({
      success: false,
      message: 'CACHE_FLUSH_SECRET is not configured on this server'
    });
  }

  const provided = String(req.get('X-Cache-Flush-Secret') || '').trim();
  if (provided !== secret) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  invalidateCatalogCache();
  flushAll();

  res.json({ success: true, message: 'Public API cache cleared' });
});

module.exports = router;
