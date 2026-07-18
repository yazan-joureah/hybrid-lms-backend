/**
 * KYC module — Public Facade.
 * Mirrors authService.js exactly. kycController.js imports ONLY this
 * facade — never a ./kyc/*.service.js file directly.
 */
const kycSubmissionService = require('./kyc/kycSubmission.service');
const kycReviewService = require('./kyc/kycReview.service');
const kycPermissionsService = require('./kyc/kycPermissions.service');
const kycDocumentStorageService = require('./kyc/kycDocumentStorage.service');
const ageDiscrepancyService = require('./kyc/ageDiscrepancy.service');

module.exports = {
  ...kycSubmissionService,
  ...kycReviewService,
  ...kycPermissionsService,
  ...kycDocumentStorageService,
  ...ageDiscrepancyService,
};
