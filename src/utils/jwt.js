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
 * Algorithm-confusion mitigation:
 *   1. `algorithms: ['HS256']` is passed explicitly to every verify call —
 *      the `alg` field embedded in the token itself is NEVER trusted.
 *   2. A `type` claim (`access` | `mfa_temp`) is checked explicitly after
 *      verification, so a 5-minute MFA-pending token can never be reused
 *      as a full 15-minute access token even though both are signed with
 *      the same secret and algorithm.
 */
const jwt = require('jsonwebtoken');
const env = require('../config/env');

const ACCESS_TOKEN_TTL = '15m';
const MFA_TEMP_TOKEN_TTL = '5m';
const MEDIA_STREAM_TICKET_TTL = '2h';
const ALLOWED_ALGORITHMS = ['HS256'];

class JwtError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function signAccessToken({ userId, sessionId }) {
  return jwt.sign(
    { sub: String(userId), sid: String(sessionId), type: 'access' },
    env.jwt.accessSecret,
    { algorithm: 'HS256', expiresIn: ACCESS_TOKEN_TTL }
  );
}

function signMfaTempToken({ userId }) {
  return jwt.sign({ sub: String(userId), type: 'mfa_temp' }, env.jwt.accessSecret, {
    algorithm: 'HS256',
    expiresIn: MFA_TEMP_TOKEN_TTL,
  });
}

function verifyRaw(token) {
  try {
    return jwt.verify(token, env.jwt.accessSecret, { algorithms: ALLOWED_ALGORITHMS });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new JwtError('EXPIRED', 'Token has expired');
    }

    throw new JwtError('INVALID', 'Token is invalid');
  }
}

function verifyAccessToken(token) {
  const decoded = verifyRaw(token);
  if (decoded.type !== 'access') {
    throw new JwtError('INVALID', 'Token is not an access token');
  }
  return decoded;
}

function verifyMfaTempToken(token) {
  const decoded = verifyRaw(token);
  if (decoded.type !== 'mfa_temp') {
    throw new JwtError('INVALID', 'Token is not an MFA temporary token');
  }
  return decoded;
}

const OAUTH_PENDING_TTL = '10m';

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

function signMediaStreamTicket({ userId, courseId, contentId }) {
  return jwt.sign(
    {
      sub: String(userId),
      courseId: String(courseId),
      contentId: String(contentId),
      type: 'media_stream',
    },
    env.jwt.accessSecret,
    { algorithm: 'HS256', expiresIn: MEDIA_STREAM_TICKET_TTL }
  );
}

function verifyMediaStreamTicket(token) {
  const decoded = verifyRaw(token);
  if (decoded.type !== 'media_stream') {
    throw new JwtError('INVALID', 'Token is not a media streaming ticket');
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
  signMediaStreamTicket,
  verifyMediaStreamTicket,
};
