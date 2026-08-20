/**
 * KYC controllers — Public Facade. kycRoutes.js imports ONLY this file.
 */
const kycSubmissionController = require('./kyc/kycSubmission.controller');

module.exports = {
  ...kycSubmissionController,
};
