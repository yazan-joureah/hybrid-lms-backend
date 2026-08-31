const registrationController = require('./auth/registration.controller');
const loginController = require('./auth/login.controller');
const mfaController = require('./auth/mfa.controller');
const oauthController = require('./auth/oauth.controller');
const accountSelfServiceController = require('./auth/accountSelfService.controller');
const guardianManageController = require('./auth/guardianManage.controller'); // ← جديد

module.exports = {
  ...registrationController,
  ...loginController,
  ...mfaController,
  ...oauthController,
  ...accountSelfServiceController,
  ...guardianManageController,
};
