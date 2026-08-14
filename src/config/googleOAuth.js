//Centralized Google OAuth2 client
//the refresh token in use was issued for https://www.googleapis.com/auth/gmail.send
// it cannot read, delete, or manage the mailbox in any way, only send mail.

const { OAuth2Client } = require('google-auth-library');
const env = require('./env');
const logger = require('../utils/logger');

const oauth2Client = new OAuth2Client(env.gmail.clientId, env.gmail.clientSecret);
oauth2Client.setCredentials({ refresh_token: env.gmail.refreshToken });

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
