/**
 * Shared session-cookie issuance — extracted from 4 identical copies
 * across authController.js (login, refresh, finishOAuthLogin) and the
 * new verifyMfaLogin (MFA-during-login). Zero behavioral change — every
 * option value below is copy-pasted verbatim from the original call sites.
 */
const env = require('../config/env');
const { generateCsrfToken, setCsrfCookie } = require('../middleware/csrfProtection');

const REFRESH_TOKEN_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Sets refresh_token (HttpOnly) + a freshly rotated csrf_token cookie on
 * the response. Call this ONCE per successful session issuance
 * (password login, MFA-completed login, refresh, OAuth login).
 */
function issueSessionCookies(res, refreshTokenRaw) {
  res.cookie('refresh_token', refreshTokenRaw, {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: REFRESH_TOKEN_COOKIE_MAX_AGE_MS,
  });

  const csrfToken = generateCsrfToken();
  setCsrfCookie(res, csrfToken, env.nodeEnv === 'production');
}

module.exports = { issueSessionCookies };
