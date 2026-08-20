// src/middleware/attachUserIfPresent.js
const { verifyAccessToken } = require('../utils/jwt');
const User = require('../models/User');

async function attachUserIfPresent(req, res, next) {
  const authHeader = req.get('authorization') || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    req.user = null;
    req.verifiedRole = null;
    return next();
  }

  try {
    const decoded = verifyAccessToken(token);
    req.user = { id: decoded.sub, sessionId: decoded.sid };
  } catch (err) {
    req.user = null;
    req.verifiedRole = null;
    return next();
  }

  const user = await User.findById(req.user.id).select('role status').lean();
  req.verifiedRole = user ? user.role : null;

  return next();
}

module.exports = { attachUserIfPresent };
