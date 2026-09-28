// src/utils/rateLimitIdentifiers.js
/**
 * Single source of truth for the secondary-axis identifier used by the
 * checkLock()/recordFailure()/recordSuccess() pattern (rateLimiter.js).
 */

function loginIdentifier(req) {
  return req.body?.email || 'unknown';
}

function mfaLoginVerifyIdentifier(req) {
  return req.body?.mfaTempToken || 'anonymous';
}

function mfaTotpVerifyIdentifier(req) {
  return req.user.id;
}

module.exports = { loginIdentifier, mfaLoginVerifyIdentifier, mfaTotpVerifyIdentifier };
