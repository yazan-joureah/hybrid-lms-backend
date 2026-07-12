/**
 * Google OAuth2 client for USER LOGIN (UC-AUTH-11) — completely separate
 * from src/config/googleOAuth.js (which authenticates OUR OWN backend to
 * send transactional email via the gmail.send scope). Different Client
 * ID/Secret, different scopes, different security boundary. See that
 * file's docstring for the explicit warning against conflating the two.
 *
 * Scope decision (CLOSED): openid + email + profile ONLY. Deliberately
 * EXCLUDES any birthday/People API scope (which Google classifies as a
 * "Restricted Scope" requiring an app verification review) — age
 * detection instead ALWAYS falls through to UC-AUTH-12's documented
 * extension [a1] ("birth date data unavailable from Google → mandatory
 * manual entry form"), turning what the UC treats as an edge case into
 * our single, deliberate code path. This keeps the app in "Testing"
 * publishing status indefinitely with zero Google review overhead.
 */
const { OAuth2Client } = require('google-auth-library');
const env = require('./env');

const LOGIN_SCOPES = ['openid', 'email', 'profile'];

const googleLoginClient = new OAuth2Client(
  env.googleOAuthLogin.clientId,
  env.googleOAuthLogin.clientSecret,
  env.googleOAuthLogin.redirectUri
);

/**
 * Builds the URL the user's browser is redirected to (GET /auth/google).
 * `state` is generated and persisted by the caller (oauthState.js) —
 * this function only embeds it, never generates it itself, keeping this
 * module focused purely on Google-specific wiring.
 */
function buildConsentUrl(state) {
  return googleLoginClient.generateAuthUrl({
    access_type: 'online', // we don't need a long-lived Google refresh token — our OWN session tokens handle that
    scope: LOGIN_SCOPES,
    state,
    prompt: 'select_account', // avoids silently reusing a stale Google session on a shared machine
  });
}

/**
 * Exchanges the authorization_code (from the callback) for Google tokens,
 * then verifies+decodes the ID token to extract the profile fields we
 * actually use. Returns ONLY the minimal fields the rest of the app
 * needs — callers never touch raw Google token objects.
 */
async function exchangeCodeForProfile(authorizationCode) {
  const { tokens } = await googleLoginClient.getToken(authorizationCode);

  const ticket = await googleLoginClient.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.googleOAuthLogin.clientId,
  });
  const payload = ticket.getPayload();

  return {
    providerUserId: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified,
    fullName: payload.name || null,
  };
}

module.exports = { buildConsentUrl, exchangeCodeForProfile };
