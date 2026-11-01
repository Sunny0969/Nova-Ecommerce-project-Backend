const AuditLog = require('../models/AuditLog');

/**
 * Record an audit log entry safely (non-blocking).
 */
function recordAuditLog({
  req,
  action,
  targetType,
  targetId,
  targetTitle,
  description,
  changes = null
}) {
  setImmediate(async () => {
    try {
      let actorName = 'System';
      let actorEmail = 'system@internal';
      let actorRole = 'system';
      let actorId = null;

      if (req?.adminUser) {
        actorName = req.adminUser.name || 'Admin';
        actorEmail = req.adminUser.email || '';
        actorRole = 'admin';
        actorId = req.adminUser._id;
      } else if (req?.staff) {
        actorName = req.staff.name || 'Staff';
        actorEmail = req.staff.email || '';
        actorRole = 'staff';
        actorId = req.staff.id;
      }

      await AuditLog.create({
        actorId,
        actorName,
        actorEmail,
        actorRole,
        action,
        targetType,
        targetId: targetId ? String(targetId) : '',
        targetTitle: targetTitle || '',
        description,
        changes,
        ipAddress: req?.ip || req?.headers?.['x-forwarded-for'] || ''
      });
    } catch (err) {
      console.warn('[AuditLog] Failed to record:', err.message);
    }
  });
}

module.exports = { recordAuditLog };

