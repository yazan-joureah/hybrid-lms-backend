// Bearer JWT authentication middleware.
const { verifyAccessToken, JwtError } = require('../utils/jwt');

function requireAuth(req, res, next) {
  const authHeader = req.get('authorization') || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({
      success: false,
      error: { code: 'MISSING_TOKEN', message: 'Authorization Bearer token is required.' },
    });
  }

  try {
    const decoded = verifyAccessToken(token);
    req.user = { id: decoded.sub, sessionId: decoded.sid };
    return next();
  } catch (err) {
    if (err instanceof JwtError && err.code === 'EXPIRED') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Access token has expired. Use POST /auth/refresh.',
        },
      });
    }

    return res.status(401).json({
      success: false,
      error: { code: 'TOKEN_INVALID', message: 'Invalid or malformed access token.' },
    });
  }
}

module.exports = { requireAuth };
