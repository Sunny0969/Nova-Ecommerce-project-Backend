/**
 * Admin Audit Logs API — /api/admin/audit-logs
 * Mount: app.use('/api/admin/audit-logs', requireAdmin, require('./routes/admin/auditLogs'));
 */

const express = require('express');
const AuditLog = require('../../models/AuditLog');

const router = express.Router();

function ok(res, data, status = 200) {
  res.status(status).json({ success: true, data });
}

function fail(res, status, message) {
  res.status(status).json({ success: false, message });
}

/**
 * GET /api/admin/audit-logs
 * List all logged actions with optional filters (action, targetType, actorRole, search, pagination)
 */
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.action) filter.action = req.query.action;
    if (req.query.targetType) filter.targetType = req.query.targetType;
    if (req.query.actorRole) filter.actorRole = req.query.actorRole;

    const search = String(req.query.search || '').trim();
    if (search) {
      filter.$or = [
        { actorName: { $regex: search, $options: 'i' } },
        { actorEmail: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { targetTitle: { $regex: search, $options: 'i' } }
      ];
    }

    const [logs, totalCount] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(totalCount / limit) || 0;

    return ok(res, {
      logs,
      totalCount,
      totalPages,
      currentPage: page
    });
  } catch (err) {
    console.error('Audit logs error:', err);
    return fail(res, 500, err.message || 'Failed to fetch audit logs');
  }
});

module.exports = router;

