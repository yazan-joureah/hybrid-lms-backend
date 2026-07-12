/**
 * JWT issuance & verification — Access Tokens and MFA Temporary Tokens.
 *
 * NOTE: Refresh Tokens are NOT JWTs in this project — they are opaque
 * random values (via crypto.js's generateOpaqueToken), stored only as a
 * SHA-256 hash (DP-08), matching the RefreshToken entity (E03). This is
 * deliberate: a Refresh Token that leaks should reveal ZERO information
 * (unlike a JWT, whose payload is only Base64-encoded, not encrypted, and
 * therefore readable by anyone who intercepts it).
 *
 * Algorithm choice: HS256, not RS256. Justification (2026 review of
 * WorkOS / ECOSIRE / ThePentesterLab guidance on JWT security): RS256's
 * main benefit is letting THIRD PARTIES verify tokens using a public key
 * without sharing a secret. This project is a single monolithic backend
 * that is BOTH the sole issuer and sole verifier of every token it
 * mints — there is no third-party verifier today, so RS256's added key
 * management complexity (key pairs, JWKS rotation, RFC 7517) would add
 * risk (more secrets to manage) without a corresponding security benefit.
 *
 * Algorithm-confusion mitigation (mandatory regardless of HS/RS choice —
 * FR-34b, already documented in Hybrid_LMS_UC_Final_Draft.pdf):
 *   1. `algorithms: ['HS256']` is passed explicitly to every verify call —
 *      the `alg` field embedded in the token itself is NEVER trusted.
 *   2. A `type` claim (`access` | `mfa_temp`) is checked explicitly after
 *      verification, so a 5-minute MFA-pending token can never be reused
 *      as a full 15-minute access token even though both are signed with
 *      the same secret and algorithm.
 */
const jwt = require('jsonwebtoken');
const env = require('../config/env');

const ACCESS_TOKEN_TTL = '15m'; // matches REST_API_Contract_v1.2 §1 (Access Token)
const MFA_TEMP_TOKEN_TTL = '5m'; // matches REST_API_Contract_v1.2 §1 (MFA Temp Token)
const ALLOWED_ALGORITHMS = ['HS256'];

class JwtError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // 'EXPIRED' | 'INVALID'
  }
}

/**
 * Issues a full Access Token for an already-authenticated, MFA-satisfied
 * session. Deliberately carries ONLY `sub` (user id) and `sid` (session
 * id) — NEVER role, permissions, or kyc_status. Those are looked up
 * fresh from MongoDB on every protected request (SF-AUTH-01), because a
 * JWT's payload is attacker-readable (Base64, not encrypted) and — more
 * importantly — cannot be revoked mid-flight if a role changes; trusting
 * it would violate FR-34 (role is server-side truth only).
 */
function signAccessToken({ userId, sessionId }) {
  return jwt.sign(
    { sub: String(userId), sid: String(sessionId), type: 'access' },
    env.jwt.accessSecret,
    { algorithm: 'HS256', expiresIn: ACCESS_TOKEN_TTL }
  );
}

/**
 * Issues the short-lived token returned by POST /auth/login when MFA is
 * required, BEFORE the user has proven the second factor. Its narrow
 * `type: 'mfa_temp'` claim is what UC-AUTH-05 will check to accept a TOTP/
 * Email OTP submission — it must never grant access to any protected
 * resource on its own.
 */
function signMfaTempToken({ userId }) {
  return jwt.sign({ sub: String(userId), type: 'mfa_temp' }, env.jwt.accessSecret, {
    algorithm: 'HS256',
    expiresIn: MFA_TEMP_TOKEN_TTL,
  });
}

/**
 * Shared low-level verification — enforces the algorithm allow-list
 * (mandatory per FR-34b) and normalizes jsonwebtoken's two distinct
 * failure classes (expired vs. anything else invalid) into one
 * predictable error shape the rest of the app can branch on.
 */
function verifyRaw(token) {
  try {
    return jwt.verify(token, env.jwt.accessSecret, { algorithms: ALLOWED_ALGORITHMS });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new JwtError('EXPIRED', 'Token has expired');
    }
    // Covers: malformed token, invalid signature, AND any attempt to
    // present an unlisted algorithm (jsonwebtoken rejects it before this
    // catch is even reached, but we never rely on that alone — see file
    // docstring above).
    throw new JwtError('INVALID', 'Token is invalid');
  }
}

/**
 * Verifies an Access Token specifically. Rejects — with the SAME
 * generic 'INVALID' code an attacker would see for a malformed token —
 * any structurally valid JWT whose `type` claim is not `access`. This is
 * the concrete enforcement of the Type Confusion mitigation described
 * in the file docstring.
 */
function verifyAccessToken(token) {
  const decoded = verifyRaw(token);
  if (decoded.type !== 'access') {
    throw new JwtError('INVALID', 'Token is not an access token');
  }
  return decoded; // { sub, sid, type, iat, exp }
}

/**
 * Verifies an MFA Temporary Token specifically (used by the not-yet-built
 * UC-AUTH-05 MFA verification endpoint) — same type-confusion guard, mirrored.
 */
function verifyMfaTempToken(token) {
  const decoded = verifyRaw(token);
  if (decoded.type !== 'mfa_temp') {
    throw new JwtError('INVALID', 'Token is not an MFA temporary token');
  }
  return decoded;
}

const OAUTH_PENDING_TTL = '10m'; // enough time for a user to type a password or birth date, not so long it's a lingering risk

function signOAuthLinkPendingToken({ email, providerUserId }) {
  return jwt.sign(
    { sub: email, providerUserId, type: 'oauth_link_pending' },
    env.jwt.accessSecret,
    { algorithm: 'HS256', expiresIn: OAUTH_PENDING_TTL }
  );
}

function verifyOAuthLinkPendingToken(token) {
  const decoded = verifyRaw(token);
  if (decoded.type !== 'oauth_link_pending') {
    throw new JwtError('INVALID', 'Token is not an OAuth link-pending token');
  }
  return decoded;
}

function signOAuthRegistrationPendingToken({ email, providerUserId, fullName }) {
  return jwt.sign(
    { sub: email, providerUserId, fullName, type: 'oauth_registration_pending' },
    env.jwt.accessSecret,
    { algorithm: 'HS256', expiresIn: OAUTH_PENDING_TTL }
  );
}

function verifyOAuthRegistrationPendingToken(token) {
  const decoded = verifyRaw(token);
  if (decoded.type !== 'oauth_registration_pending') {
    throw new JwtError('INVALID', 'Token is not an OAuth registration-pending token');
  }
  return decoded;
}

function signOAuthGuardianPendingToken({ userId }) {
  return jwt.sign({ sub: String(userId), type: 'oauth_guardian_pending' }, env.jwt.accessSecret, {
    algorithm: 'HS256',
    expiresIn: '10m',
  });
}

function verifyOAuthGuardianPendingToken(token) {
  const decoded = verifyRaw(token);
  if (decoded.type !== 'oauth_guardian_pending') {
    throw new JwtError('INVALID', 'Token is not an OAuth guardian-pending token');
  }
  return decoded;
}

module.exports = {
  signAccessToken,
  signMfaTempToken,
  verifyAccessToken,
  verifyMfaTempToken,
  JwtError,
  signOAuthLinkPendingToken,
  verifyOAuthLinkPendingToken,
  signOAuthRegistrationPendingToken,
  verifyOAuthRegistrationPendingToken,
  signOAuthGuardianPendingToken,
  verifyOAuthGuardianPendingToken,
};
