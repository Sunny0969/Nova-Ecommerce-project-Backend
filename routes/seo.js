const express = require('express');

const router = express.Router();

/**
 * POST /api/seo/not-found — log client-side 404 hits (SPA soft-404 mitigation).
 * Body: { path, referrer, userAgent }
 */
router.post('/not-found', express.json(), (req, res) => {
  const path = String(req.body?.path || '').slice(0, 500);
  const referrer = String(req.body?.referrer || '').slice(0, 500);
  const ua = String(req.body?.userAgent || req.get('user-agent') || '').slice(0, 300);
  if (path) {
    console.warn('[seo:404]', JSON.stringify({ path, referrer, ua, at: new Date().toISOString() }));
  }
  res.status(204).end();
});

module.exports = router;
