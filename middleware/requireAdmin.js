const User = require('../models/User');
const { verifyToken, parseBearerToken } = require('./jwtAuth');

/**
 * Requires a valid JWT and User.role === 'admin'.
 * Sets req.authUserId and req.adminUser.
 */
async function requireAdmin(req, res, next) {
  const raw = parseBearerToken(req);
  if (!raw) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }
  try {
    const payload = verifyToken(raw);
    if (!payload?.sub) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token payload'
      });
    }
    const user = await User.findById(payload.sub).select('role email name');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }
    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }
    req.authUserId = payload.sub;
    req.adminUser = user;
    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
}

module.exports = requireAdmin;
