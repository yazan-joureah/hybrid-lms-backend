const { OAuth2Client } = require('google-auth-library');
const env = require('./env');

const LOGIN_SCOPES = ['openid', 'email', 'profile'];

const googleLoginClient = new OAuth2Client(
  env.googleOAuthLogin.clientId,
  env.googleOAuthLogin.clientSecret,
  env.googleOAuthLogin.redirectUri
);

// Builds the URL the user's browser is redirected to (GET /auth/google).
function buildConsentUrl(state) {
  return googleLoginClient.generateAuthUrl({
    access_type: 'online',
    scope: LOGIN_SCOPES,
    state,
    prompt: 'select_account',
  });
}

// Exchanges the authorization_code (from the callback) for Google tokens,
//then verifies+decodes the ID token to extract the profile fields we
//actually use.
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
