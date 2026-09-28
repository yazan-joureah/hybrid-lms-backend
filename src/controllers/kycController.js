const kycSubmissionController = require('./kyc/kycSubmission.controller');
const kycAgeCorrectionController = require('./kyc/kycAgeCorrection.controller');

module.exports = {
  ...kycSubmissionController,
  ...kycAgeCorrectionController,
};
