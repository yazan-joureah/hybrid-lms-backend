const registrationController = require('./auth/registration.controller');
const loginController = require('./auth/login.controller');
const mfaController = require('./auth/mfa.controller');
const oauthController = require('./auth/oauth.controller');
const accountSelfServiceController = require('./auth/accountSelfService.controller');

module.exports = {
  ...registrationController,
  ...loginController,
  ...mfaController,
  ...oauthController,
  ...accountSelfServiceController,
};
