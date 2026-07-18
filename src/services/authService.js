const registrationService = require('./auth/registration.service');
const sessionService = require('./auth/session.service');
const passwordRecoveryService = require('./auth/passwordRecovery.service');
const mfaService = require('./auth/mfa.service');
const oauthService = require('./auth/oauth.service');

module.exports = {
  ...registrationService,
  ...sessionService,
  ...passwordRecoveryService,
  ...mfaService,
  ...oauthService,
};
