/**
 * Centralized Google OAuth2 client — used EXCLUSIVELY for server-to-server
 * Gmail sending (transactional emails: verification, guardian approval,
 * password reset, etc.).
 *
 * ⚠️ ARCHITECTURAL BOUNDARY — READ BEFORE REUSING THIS FILE:
 * This is a SEPARATE OAuth2 client from the one UC-AUTH-11 ("Login via
 * Google OAuth") will need later. This module authenticates OUR OWN
 * backend to send mail from ONE fixed Gmail account, using a Refresh
 * Token issued once via OAuth Playground with the single scope
 * `gmail.send`. UC-AUTH-11 instead lets ARBITRARY end-users sign in with
 * their OWN Google accounts (Authorization Code flow, different Client ID,
 * different scopes: openid/email/profile). Never reuse these credentials
 * for that flow — they are unrelated concerns that happen to both be
 * "Google OAuth".
 *
 * Least privilege (RFC 9700 §2.1, IETF Best Current Practice for OAuth 2.0
 * Security, Jan 2025): the refresh token in use was issued for
 * https://www.googleapis.com/auth/gmail.send ONLY — it cannot read,
 * delete, or manage the mailbox in any way, only send mail.
 */
const { OAuth2Client } = require('google-auth-library');
const env = require('./env');
const logger = require('../utils/logger');

const oauth2Client = new OAuth2Client(env.gmail.clientId, env.gmail.clientSecret);
oauth2Client.setCredentials({ refresh_token: env.gmail.refreshToken });

/**
 * NOTE: as of the Gmail REST API migration (emailService.js), this
 * function is no longer called directly — `googleapis`'s `google.gmail()`
 * client refreshes tokens internally via the same `oauth2Client` instance.
 * Kept exported intentionally for any FUTURE module that needs a raw
 * Bearer token for a direct HTTP call outside the `googleapis` SDK.
 */
async function getAccessToken() {
  try {
    const { token } = await oauth2Client.getAccessToken();

    if (!token) {
      throw new Error('Google returned an empty access token');
    }

    return token;
  } catch (err) {
    logger.error('Failed to obtain/refresh Gmail access token', {
      error: err.message,
      response: err.response?.data,
      stack: err.stack,
    });

    throw err;
  }
}

module.exports = { oauth2Client, getAccessToken };
