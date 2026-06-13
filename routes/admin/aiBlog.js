const express = require('express');
const requireAdmin = require('../../middleware/requireAdmin');
const { autoGenerateTrendingBlog, getAiBlogConfigStatus } = require('../../controllers/aiBlogController');

const router = express.Router();

/**
 * GET /api/admin/blog/ai/status — is Hugging Face configured? (no secrets returned)
 */
router.get('/status', requireAdmin, (req, res) => {
  return res.json({ success: true, data: getAiBlogConfigStatus() });
});

/**
 * POST /api/admin/blog/ai/generate
 * Manually trigger one AI SEO blog draft (admin approval via status=draft).
 */
router.post('/generate', requireAdmin, async (req, res) => {
  try {
    const result = await autoGenerateTrendingBlog();
    if (!result.created) {
      return res.status(result.reason === 'missing_hf_key' ? 503 : 409).json({
        success: false,
        message:
          result.reason === 'missing_hf_key'
            ? 'HUGGINGFACE_API_KEY is not configured. Localhost uses backend/.env — add the key there and restart npm start. On Railway, set Variables on the backend service and redeploy latest code.'
            : result.reason === 'duplicate_slug'
              ? 'A blog with this slug already exists.'
              : result.reason || 'Blog was not created.',
        data: result
      });
    }
    return res.status(201).json({
      success: true,
      message: 'SEO blog draft created. Publish from admin when ready.',
      data: { post: result.post }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'AI blog generation failed' });
  }
});

module.exports = router;
