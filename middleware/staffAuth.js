const StaffAccess = require('../models/StaffAccess');
const User = require('../models/User');
const { verifyToken, parseBearerToken } = require('./jwtAuth');

/**
 * Staff-only middleware: verifies JWT, requires payload.role === 'staff',
 * loads staff record, and attaches { id, email, name, permissions } to req.staff.
 */
async function isStaff(req, res, next) {
  const raw = parseBearerToken(req);
  if (!raw) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  let payload;
  try {
    payload = verifyToken(raw);
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
  if (!payload?.sub || payload.role !== 'staff') {
    return res.status(403).json({ success: false, message: 'Staff access required' });
  }

  const staff = await StaffAccess.findById(payload.sub)
    .select('email name status blockedUntil permissions lastLogin')
    .lean();
  if (!staff) {
    return res.status(401).json({ success: false, message: 'Account not found' });
  }
  if (staff.status === 'blocked') {
    const until = staff.blockedUntil ? new Date(staff.blockedUntil).getTime() : null;
    if (until && until <= Date.now()) {
      // auto-unblock when expired
      await StaffAccess.updateOne(
        { _id: staff._id },
        { $set: { status: 'active', blockedUntil: null } }
      );
      staff.status = 'active';
      staff.blockedUntil = null;
    } else {
      return res.status(403).json({ success: false, message: 'Your access has been blocked' });
    }
  }

  req.staff = {
    id: String(staff._id),
    email: staff.email,
    name: staff.name,
    permissions: staff.permissions || {}
  };
  return next();
}

/**
 * Permission gate for staff routes.
 * @param {keyof import('../models/StaffAccess').permissionsSchema} permissionName
 */
function hasPermission(permissionName) {
  return function permissionMiddleware(req, res, next) {
    const ok = Boolean(req.staff?.permissions?.[permissionName]);
    if (!ok) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission for this action"
      });
    }
    return next();
  };
}

/**
 * Mixed auth: allows admin users OR staff users.
 * Attaches req.adminUser (for admins) OR req.staff (for staff).
 *
 * Note: This bypasses requireJwtAuth's customer checks by directly verifying JWT.
 * Admin JWTs are validated by loading User.role === 'admin'.
 */
async function isAdminOrStaff(req, res, next) {
  const raw = parseBearerToken(req);
  if (!raw) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  let payload;
  try {
    payload = verifyToken(raw);
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
  if (!payload?.sub) {
    return res.status(401).json({ success: false, message: 'Invalid token payload' });
  }

  if (payload.role === 'staff') {
    // reuse staff checks
    return isStaff(req, res, next);
  }

  const user = await User.findById(payload.sub).select('role email name').lean();
  if (!user) {
    return res.status(401).json({ success: false, message: 'User not found' });
  }
  if (user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  req.authUserId = payload.sub;
  req.adminUser = user;
  return next();
}

/**
 * For endpoints that allow admins always, but staff only with a specific permission.
 */
function adminOrStaffPermission(permissionName) {
  return [
    isAdminOrStaff,
    (req, res, next) => {
      if (req.adminUser) return next();
      return hasPermission(permissionName)(req, res, next);
    }
  ];
}

module.exports = {
  isStaff,
  hasPermission,
  isAdminOrStaff,
  adminOrStaffPermission
};

