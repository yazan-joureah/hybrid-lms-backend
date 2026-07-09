/**
 * Double-Submit Cookie CSRF protection — applied ONLY to POST /auth/refresh,
 * the single endpoint in this module that authenticates via cookie alone
 * (no Bearer JWT requirement — see file docstring discussion in the
 * CodeQL CSRF alert analysis). All other state-changing routes require
 * Authorization: Bearer <JWT>, which a cross-site forged request cannot
 * attach — they are NOT vulnerable to CSRF and do not need this.
 *
 * Mechanism: a random CSRF token is issued as a NON-HttpOnly cookie
 * (readable by our own frontend JS) at login time. The client must echo
 * this exact value back in the `X-CSRF-Token` header on the refresh
 * request. A cross-site attacker can trigger the browser to SEND the
 * cookie (if SameSite were bypassed), but cannot READ its value to also
 * set the matching header — same-origin policy prevents that read.
 */
const crypto = require('crypto');

const CSRF_COOKIE_NAME = 'csrf_token';

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function setCsrfCookie(res, token, isProduction) {
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false, // MUST be readable by frontend JS — this is the point
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // matches refresh_token's own lifetime
  });
}

function requireCsrfToken(req, res, next) {
  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.get('x-csrf-token');

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({
      success: false,
      error: { code: 'CSRF_TOKEN_INVALID', message: 'Missing or invalid CSRF token.' },
    });
  }
  next();
}

module.exports = { generateCsrfToken, setCsrfCookie, requireCsrfToken, CSRF_COOKIE_NAME };
