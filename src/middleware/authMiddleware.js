/**
 * Bearer JWT authentication middleware.
 * Source: UC-AUTH-07, REST_API_Contract_v1.2 ("Auth: Bearer JWT").
 *
 * Populates req.user = { id, sessionId } ONLY — never role, permissions,
 * or kyc_status. This is a direct continuation of FR-34 (role is
 * server-side truth from the database, never trusted from a token) — any
 * route needing role-based authorization must still query User fresh
 * (exactly like SF-AUTH-01 already does), not read it from req.user.
 *
 * KNOWN, DOCUMENTED, ACCEPTED TRADE-OFF:
 * Logging out revokes the RefreshToken (and, once built, the Session)
 * immediately — but a stolen/leaked Access Token remains cryptographically
 * valid for up to its remaining 15-minute lifetime, because JWTs are
 * stateless by design (that's the whole reason we chose them for this
 * layer — see jwt.js docstring). We do NOT query the database on every
 * single authenticated request to check live session status, because
 * that would defeat the entire performance rationale for using a
 * stateless token here. The short 15-minute TTL is itself the mitigation
 * for this window — this is the standard, well-understood trade-off in
 * JWT-based systems, not an oversight. A future enhancement (documented
 * here for the eventual Refactor phase) could add an optional Redis-based
 * short-lived revocation blocklist keyed by session_id for routes that
 * truly need instant revocation (e.g. Admin force-logout) — deferred
 * deliberately, out of scope for the current AUTH module completion.
 */
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
    // Covers: malformed token, invalid signature, wrong `type` claim
    // (e.g. an mfa_temp token presented here) — see jwt.js's
    // verifyAccessToken for the Type Confusion guard itself.
    return res.status(401).json({
      success: false,
      error: { code: 'TOKEN_INVALID', message: 'Invalid or malformed access token.' },
    });
  }
}

module.exports = { requireAuth };
