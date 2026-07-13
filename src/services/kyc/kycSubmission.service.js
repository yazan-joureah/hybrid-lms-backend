// src/services/kyc/kycSubmission.service.js
//
// Implementation of the complete UC-KYC-01: Receives two files (ID document + Selfie),
// verifies eligibility prerequisites, passes each file through
// kycDocumentStorage.service.js (SF-KYC-02: format validation + virus scan +
// encryption + storage), then creates a KYCRequest record and updates
// User.kyc_status.
//
// Intentional Note: The "Email Admin Notification" feature (Step 8 in the original UC text)
// has been explicitly removed — we rely solely on Audit Logging. Admins discover
// new requests via direct queries in UC-KYC-02 (Pending Requests List), not via
// immediate notification. This deviation from the original UC must be documented in the
// final thesis document.
//
// References: FR-42, FR-43, FR-44, FR-30 | MUC-KYC-01, MUC-KYC-02
// Decisions previously established in this conversation:
//    - Instructor: Lighter check (mfa_enabled === true) instead of full SF-AUTH-03
//    - age_flagged is treated as an existing request that blocks a new submission
//      (same as review_pending)
//    - User.kyc_status: 'pending' renamed to 'review_pending' to match KYCRequest.status

const User = require('../../models/User');
const KYCRequest = require('../../models/KYCRequest');
const KYCDocument = require('../../models/KYCDocument');
const { encryptAndStoreDocument } = require('./kycDocumentStorage.service');
const auditService = require('../auditService');

const ELIGIBLE_APPLICANT_ROLES = ['Student', 'Instructor'];
const RESUBMITTABLE_KYC_STATUSES = ['not_submitted', 'rejected'];
const BLOCKING_KYC_STATUSES = ['review_pending', 'age_flagged'];

/**
 * Function 1: Validate eligibility prerequisites (Prerequisites 1-5 in UC-KYC-01)
 * before any file processing — Fail Fast to avoid wasting virus scanning/
 * encryption cycles on a request that will be rejected anyway.
 *
 * @param {object} user - Full User document from database
 * @returns {{eligible: boolean, reason?: string}}
 */
function checkSubmissionEligibility(user) {
  if (user.status !== 'active') {
    return { eligible: false, reason: 'ACCOUNT_NOT_ACTIVE' };
  }

  if (!ELIGIBLE_APPLICANT_ROLES.includes(user.role)) {
    // Admin/SuperAdmin لا يقدّمون طلبات KYC عبر هذا المسار إطلاقاً
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

/**
 * Function 2: Handle storage of a single document, with clear failure indications
 * (format/virus/technical) to be displayed appropriately to the user later in the upper layer.
 */
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

/**
 * Main exported function — complete UC-KYC-01.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {'national_id'|'passport'} params.idDocumentType - Chosen official document type
 * @param {{buffer: Buffer, filename: string}} params.idDocumentFile
 * @param {{buffer: Buffer, filename: string}} params.selfieFile
 * @param {import('express').Request} params.req
 * @returns {Promise<{success: boolean, reason?: string}>}
 */
async function submitKycRequest({ userId, idDocumentType, idDocumentFile, selfieFile, req }) {
  // Step 1: Fetch the user freshly from the database — we do not trust any field
  // coming from the JWT (same philosophy as SF-AUTH-01: role and status are server-side truths only).
  const user = await User.findById(userId);
  if (!user) {
    return { success: false, reason: 'USER_NOT_FOUND' };
  }

  const actorRole = user.role;

  // الخطوة 2: فحص الأهلية (فشل سريع قبل أي معالجة ملفات مكلفة)
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
    // لا شيء لتنظيفه بعد — الفشل حدث قبل أي تخزين فعلي
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

  // Step 6: Update KYC status directly on the user (used later in SF-AUTH-03,
  // UC-COURSE-05, etc. — single server-side truth synchronized with the request)
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

module.exports = {
  submitKycRequest,
  checkSubmissionEligibility, // مُصدَّرة للاختبار المباشر
};
