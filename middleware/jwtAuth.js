const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getJwtSecret } = require('../lib/envSecurity');

/**
 * @param {import('mongoose').Document} user
 * @returns {string}
 */
function verifyToken(tokenString) {
  return jwt.verify(tokenString, getJwtSecret());
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      email: user.email
    },
    getJwtSecret(),
    {
      expiresIn:
        process.env.JWT_EXPIRE || process.env.JWT_EXPIRES_IN || '7d'
    }
  );
}

function parseBearerToken(req) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  const raw = h.slice(7).trim();
  return raw || null;
}

/**
 * Optional JWT: sets req.authUserId when Authorization: Bearer <valid JWT>.
 * Missing or empty Bearer → guest (next). Malformed / expired token → 401.
 */
function attachJwtUser(req, res, next) {
  req.authUserId = null;
  const raw = parseBearerToken(req);
  if (!raw) return next();
  try {
    const payload = verifyToken(raw);
    if (!payload.sub) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token payload'
      });
    }
    req.authUserId = payload.sub;
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
  next();
}

/**
 * Required JWT: verifies Bearer token and sets req.authUserId.
 * Use on protected routes (cart, orders). Responds 401 if missing or invalid.
 * Customers with isActive false receive 403 (admins are not blocked by isActive).
 */
async function requireJwtAuth(req, res, next) {
  req.authUserId = null;
  const raw = parseBearerToken(req);
  if (!raw) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required. Send Authorization: Bearer <token>.'
    });
  }
  try {
    const payload = verifyToken(raw);
    if (!payload.sub) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token payload'
      });
    }
    req.authUserId = payload.sub;

    const user = await User.findById(payload.sub).select('isActive role');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Account not found'
      });
    }
    if (user.role === 'customer' && user.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'Account suspended'
      });
    }
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }
    next(err);
  }
}

/**
 * Optional JWT for public GETs: sets req.authUserId when Bearer token is valid.
 * Invalid or expired tokens are ignored (guest) — no 401.
 */
function attachJwtUserSilent(req, res, next) {
  req.authUserId = null;
  const raw = parseBearerToken(req);
  if (!raw) return next();
  try {
    const payload = verifyToken(raw);
    if (payload?.sub) req.authUserId = payload.sub;
  } catch {
    /* treat as guest */
  }
  next();
}

module.exports = {
  signToken,
  verifyToken,
  parseBearerToken,
  attachJwtUser,
  attachJwtUserSilent,
  requireJwtAuth,
  getJwtSecret
};
