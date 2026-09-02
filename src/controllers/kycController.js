/**
 * KYC controllers — Public Facade. kycRoutes.js imports ONLY this file.
 */
const kycSubmissionController = require('./kyc/kycSubmission.controller');
const kycAgeCorrectionController = require('./kyc/kycAgeCorrection.controller');

module.exports = {
  ...kycSubmissionController,
  ...kycAgeCorrectionController,
};
