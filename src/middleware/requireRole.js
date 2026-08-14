// src/middleware/requireRole.js

const User = require('../models/User');

function requireRole(allowedRoles) {
  if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) {
    throw new Error('requireRole() requires a non-empty array of allowed roles');
  }

  return async function roleCheckMiddleware(req, res, next) {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        error: { code: 'MISSING_TOKEN', message: 'Authentication is required before role check.' },
      });
    }

    const user = await User.findById(req.user.id).select('role status').lean();

    if (!user || !allowedRoles.includes(user.role)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' },
      });
    }

    req.verifiedRole = user.role;
    return next();
  };
}

module.exports = { requireRole };
