// src/utils/rateLimitIdentifiers.js
/**
 * Single source of truth for the secondary-axis identifier used by the
 * checkLock()/recordFailure()/recordSuccess() pattern (rateLimiter.js).
 *
 * DEVIATION/SECURITY: these MUST be imported by BOTH the route (checkLock)
 * and the controller (recordFailure/recordSuccess) for the same action.
 * Defining the extractor logic twice risks silent drift — a mismatched
 * key means the lockout mechanism silently stops working with no error.
 */

function loginIdentifier(req) {
  return req.body?.email || 'unknown';
}

function mfaLoginVerifyIdentifier(req) {
  return req.body?.mfaTempToken || 'anonymous';
}

function mfaTotpVerifyIdentifier(req) {
  // requireAuth already ran on both the route and the controller by the
  // time this is called — req.user.id is always present.
  return req.user.id;
}

module.exports = { loginIdentifier, mfaLoginVerifyIdentifier, mfaTotpVerifyIdentifier };
