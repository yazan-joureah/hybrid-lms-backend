const registrationService = require('./auth/registration.service');
const sessionService = require('./auth/session.service');
const passwordRecoveryService = require('./auth/passwordRecovery.service');
const mfaService = require('./auth/mfa.service');
const oauthService = require('./auth/oauth.service');
const accountDeletionService = require('./auth/accountDeletionRequest.service');
const accountListingService = require('./auth/accountListing.service');
const accountRestoreService = require('./auth/accountRestore.service');
const accountRevocationService = require('./auth/accountRevocation.service');
const manageAccountService = require('./auth/manageAccounts.service');

module.exports = {
  ...registrationService,
  ...sessionService,
  ...passwordRecoveryService,
  ...mfaService,
  ...oauthService,
  ...accountDeletionService,
  ...accountListingService,
  ...accountRestoreService,
  ...accountRevocationService,
  ...manageAccountService,
};
