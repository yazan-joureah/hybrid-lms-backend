/**
 * Shared session-cookie issuance — extracted from 4 identical copies
 * across authController.js (login, refresh, finishOAuthLogin) and the
 * new verifyMfaLogin (MFA-during-login). Zero behavioral change — every
 * option value below is copy-pasted verbatim from the original call sites.
 */
const env = require('../config/env');
const {
  generateCsrfToken,
  setCsrfCookie,
  CSRF_COOKIE_NAME,
} = require('../middleware/csrfProtection');

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

/**
 * Clears refresh_token + csrf_token cookies on logout — extracted from the
 * inline res.clearCookie() pair that used to live directly in
 * authController.logout(). Zero behavioral change — every option value
 * below is copy-pasted verbatim from that original call site.
 *
 * IMPORTANT: res.clearCookie() only removes a cookie from the browser if
 * the options passed here (path, domain, sameSite, secure) EXACTLY match
 * the options the cookie was originally set with. httpOnly/maxAge/expires
 * do NOT need to match, but path/domain/sameSite/secure DO — a mismatch
 * here silently no-ops and leaves the old cookie alive in the browser.
 *
 * Call this from authController.logout() AFTER session.service.logoutUser()
 * has revoked the session/refresh token server-side.
 */
function clearSessionCookies(res) {
  res.clearCookie('refresh_token', {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
  });
  res.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
  });
}

module.exports = { issueSessionCookies, clearSessionCookies };
