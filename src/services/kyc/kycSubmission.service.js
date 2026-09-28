// src/services/kyc/kycSubmission.service.js

const User = require('../../models/User');
const KYCRequest = require('../../models/KYCRequest');
const KYCDocument = require('../../models/KYCDocument');
const { encryptAndStoreDocument } = require('./kycDocumentStorage.service');
const auditService = require('../auditService');

const ELIGIBLE_APPLICANT_ROLES = ['Student', 'Instructor'];
const RESUBMITTABLE_KYC_STATUSES = ['not_submitted', 'rejected'];
const BLOCKING_KYC_STATUSES = ['review_pending', 'age_flagged'];

function checkSubmissionEligibility(user) {
  if (user.status !== 'active') {
    return { eligible: false, reason: 'ACCOUNT_NOT_ACTIVE' };
  }

  if (!ELIGIBLE_APPLICANT_ROLES.includes(user.role)) {
    // Admin/SuperAdmin
    return { eligible: false, reason: 'ROLE_NOT_ELIGIBLE' };
  }

  if (user.role === 'Instructor' && !user.mfa_enabled) {
    // Lighter check established previously — mfa_enabled only, no current MFA session required
    return { eligible: false, reason: 'MFA_NOT_ENABLED' };
  }

  if (BLOCKING_KYC_STATUSES.includes(user.kyc_status)) {
    // Includes both review_pending and age_flagged — decision established previously
    return { eligible: false, reason: 'REQUEST_ALREADY_PENDING' };
  }

  if (!RESUBMITTABLE_KYC_STATUSES.includes(user.kyc_status)) {
    // The only remaining state here is 'verified' — no need to resubmit
    return { eligible: false, reason: 'ALREADY_VERIFIED' };
  }

  return { eligible: true };
}

async function storeSingleDocument({ buffer, filename, userId, actorRole, documentType, req }) {
  return encryptAndStoreDocument({
    buffer,
    declaredFilename: filename,
    userId,
    actorRole,
    documentType,
    req,
  });
}

async function submitKycRequest({ userId, idDocumentType, idDocumentFile, selfieFile, req }) {
  // Step 1: Fetch the user freshly from the database
  const user = await User.findById(userId);
  if (!user) {
    return { success: false, reason: 'USER_NOT_FOUND' };
  }

  const actorRole = user.role;

  const eligibility = checkSubmissionEligibility(user);
  if (!eligibility.eligible) {
    await auditService.record({
      actorId: userId,
      actorRole,
      action: 'KYC_SUBMISSION_REJECTED_ELIGIBILITY',
      resourceType: 'KYCRequest',
      resourceId: userId,
      metadata: { reason: eligibility.reason },
      req,
    });
    return { success: false, reason: eligibility.reason };
  }

  // Step 3: Store official ID document
  const idDocumentResult = await storeSingleDocument({
    buffer: idDocumentFile.buffer,
    filename: idDocumentFile.filename,
    userId,
    actorRole,
    documentType: idDocumentType,
    req,
  });

  if (!idDocumentResult.success) {
    return { success: false, reason: idDocumentResult.reason };
  }

  // Step 4: Store Selfie
  const selfieResult = await storeSingleDocument({
    buffer: selfieFile.buffer,
    filename: selfieFile.filename,
    userId,
    actorRole,
    documentType: 'selfie',
    req,
  });

  if (!selfieResult.success) {
    // Compensating Rollback: ID document stored successfully, but Selfie failed.
    // To avoid an orphaned KYCDocument without an associated KYCRequest, delete it immediately.
    await KYCDocument.deleteOne({ file_reference: idDocumentResult.fileReference });
    return { success: false, reason: selfieResult.reason };
  }

  // Step 5: Create request record
  const kycRequest = await KYCRequest.create({
    user_id: userId,
    applicant_role: actorRole,
    id_document_reference: idDocumentResult.fileReference,
    selfie_reference: selfieResult.fileReference,
    status: 'review_pending',
  });

  // Step 6: Update KYC status directly on the user
  await User.findByIdAndUpdate(userId, { kyc_status: 'review_pending' });

  // Step 7: Record success
  await auditService.record({
    actorId: userId,
    actorRole,
    action: 'KYC_REQUEST_SUBMITTED',
    resourceType: 'KYCRequest',
    resourceId: String(kycRequest._id),
    metadata: { idDocumentType },
    req,
  });

  return { success: true };
}

async function getMyLatestKycRequest({ userId }) {
  const latest = await KYCRequest.findOne({ user_id: userId })
    .sort({ submitted_at: -1 })
    .select('status review_decision_reason age_discrepancy_years submitted_at reviewed_at');

  if (!latest) {
    return null;
  }

  return {
    status: latest.status,
    reviewDecisionReason: latest.review_decision_reason,
    ageDiscrepancyYears: latest.age_discrepancy_years,
    submittedAt: latest.submitted_at,
    reviewedAt: latest.reviewed_at,
  };
}

module.exports = {
  submitKycRequest,
  checkSubmissionEligibility,
  getMyLatestKycRequest,
};
