/**
 * KYC controllers — Public Facade. kycRoutes.js imports ONLY this file.
 */
const kycSubmissionController = require('./kyc/kycSubmission.controller');
const kycReviewController = require('./kyc/kycReview.controller');

module.exports = {
  ...kycSubmissionController,
  ...kycReviewController,
};
