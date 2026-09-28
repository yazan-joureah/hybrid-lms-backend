const kycSubmissionService = require('./kyc/kycSubmission.service');
const kycReviewService = require('./kyc/kycReview.service');
const kycPermissionsService = require('./kyc/kycPermissions.service');
const kycDocumentStorageService = require('./kyc/kycDocumentStorage.service');
const ageDiscrepancyService = require('./kyc/ageDiscrepancy.service');
const ageCorrectionService = require('./kyc/ageCorrection.service');

module.exports = {
  ...kycSubmissionService,
  ...kycReviewService,
  ...kycPermissionsService,
  ...kycDocumentStorageService,
  ...ageDiscrepancyService,
  ...ageCorrectionService,
};
