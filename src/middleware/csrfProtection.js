//Origin-based CSRF protection — replaces the Double-Submit Cookie pattern.

const env = require('../config/env');
const logger = require('../utils/logger');

function buildAllowedOrigins() {
  const origins = [env.appUrl, 'http://localhost:5173', 'http://localhost:8443'];
  if (process.env.DEMO_FRONTEND_ORIGIN) {
    origins.push(process.env.DEMO_FRONTEND_ORIGIN);
  }
  return [...new Set(origins.filter(Boolean))];
}

const ALLOWED_ORIGINS = buildAllowedOrigins();

function requireTrustedOrigin(req, res, next) {
  const origin = req.get('origin');
  const referer = req.get('referer');

  const sourceOrigin = origin || (referer ? new URL(referer).origin : null);

  if (!sourceOrigin || !ALLOWED_ORIGINS.includes(sourceOrigin)) {
    logger.warn('Blocked refresh request — untrusted or missing Origin', {
      origin,
      referer,
      ip: req.ip,
    });
    return res.status(403).json({
      success: false,
      error: { code: 'CSRF_TOKEN_INVALID', message: 'Untrusted request origin.' },
    });
  }

  return next();
}

module.exports = { requireTrustedOrigin, ALLOWED_ORIGINS };
