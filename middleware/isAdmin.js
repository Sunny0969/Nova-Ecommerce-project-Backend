const User = require('../models/User');

/**
 * After requireJwtAuth: ensures the user exists and has role `admin`.
 */
async function requireAdmin(req, res, next) {
  try {
    if (!req.authUserId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    const user = await User.findById(req.authUserId).select('role').lean();
    if (!user || user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAdmin };
