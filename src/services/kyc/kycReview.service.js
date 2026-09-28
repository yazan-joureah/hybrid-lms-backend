// src/services/kyc/kycReview.service.js

const User = require('../../models/User');
const KYCRequest = require('../../models/KYCRequest');
const { isMinor } = require('../../utils/ageCalculator');
const { evaluateAgeDiscrepancy } = require('./ageDiscrepancy.service');
const { revokeAllSessionsAndOAuth } = require('../auth/accountRevocation.service');
const { grantInstructorPermissions } = require('./kycPermissions.service');
const auditService = require('../auditService');

const REJECTION_REASONS = [
  'UNCLEAR_IMAGE',
  'DOCUMENT_EXPIRED',
  'DATA_MISMATCH',
  'DOCUMENT_NOT_ACCEPTED',
];

async function getRequestForReview(kycRequestId) {
  const kycRequest = await KYCRequest.findById(kycRequestId);
  if (!kycRequest || kycRequest.status !== 'review_pending') {
    return null;
  }
  const applicant = await User.findById(kycRequest.user_id);
  if (!applicant) {
    return null;
  }
  return { kycRequest, applicant };
}

function determineReviewOutcome({
  applicantRole,
  applicantBirthDate,
  documentBirthDate,
  confirmYellowTier,
}) {
  const documentDate = new Date(documentBirthDate);
  const trueAgeIsMinor = isMinor(documentDate);

  // === STEP 1/2 — MINOR-FIRST FIREWALL ===
  if (trueAgeIsMinor) {
    if (applicantRole === 'Instructor') {
      return { decision: 'HARD_REJECT_SUSPEND_MINOR_INSTRUCTOR' };
    }

    const registeredAsMinor = isMinor(applicantBirthDate);
    if (!registeredAsMinor) {
      return { decision: 'FLAG_FOR_GUARDIAN_CORRECTION', bypassDetected: true };
    }

    const ageResult = evaluateAgeDiscrepancy(applicantBirthDate, documentDate);
    if (ageResult.tier === 'red') {
      return { decision: 'FLAG_FOR_GUARDIAN_CORRECTION', bypassDetected: false, ageResult };
    }
    if (ageResult.tier === 'yellow' && !confirmYellowTier) {
      return { decision: 'NEEDS_YELLOW_CONFIRMATION', ageResult };
    }
    return { decision: 'APPROVE_AND_SYNC', ageResult, documentDate };
  }

  // === STEP 3 — TRUE ADULT (by document) — normal discrepancy math ===
  const ageResult = evaluateAgeDiscrepancy(applicantBirthDate, documentDate);

  if (ageResult.tier === 'red') {
    return { decision: 'REJECT_DATA_MISMATCH_AND_CORRECT', ageResult, documentDate };
  }
  if (ageResult.tier === 'yellow' && !confirmYellowTier) {
    return { decision: 'NEEDS_YELLOW_CONFIRMATION', ageResult };
  }
  return { decision: 'APPROVE_AND_SYNC', ageResult, documentDate };
}

async function hardRejectSuspendMinorInstructor({
  kycRequest,
  applicant,
  adminUserId,
  adminRole,
  req,
}) {
  kycRequest.status = 'rejected';
  kycRequest.review_decision_reason = 'MINOR_CANNOT_BE_INSTRUCTOR';
  kycRequest.reviewed_by_admin_id = adminUserId;
  kycRequest.reviewed_at = new Date();
  await kycRequest.save();

  await User.findByIdAndUpdate(applicant._id, { kyc_status: 'rejected', status: 'suspended' });

  await revokeAllSessionsAndOAuth({
    userId: applicant._id,
    reason: 'KYC_REVEALED_MINOR_CLAIMING_INSTRUCTOR',
    triggeredByAdminId: adminUserId,
    req,
  });

  await auditService.record({
    actorId: adminUserId,
    actorRole: adminRole,
    action: 'KYC_MINOR_INSTRUCTOR_AUTO_SUSPENDED',
    resourceType: 'KYCRequest',
    resourceId: String(kycRequest._id),
    metadata: { target_user_id: String(applicant._id) },
    req,
  });

  return { success: true, outcome: 'rejected_suspended' };
}

async function flagForGuardianCorrection({
  kycRequest,
  applicant,
  adminUserId,
  adminRole,
  bypassDetected,
  ageResult,
  req,
}) {
  kycRequest.status = 'age_flagged';
  kycRequest.age_discrepancy_years = ageResult?.discrepancyYears ?? null;
  kycRequest.reviewed_by_admin_id = adminUserId;
  kycRequest.reviewed_at = new Date();
  await kycRequest.save();

  await User.findByIdAndUpdate(applicant._id, { kyc_status: 'age_flagged' });

  await auditService.record({
    actorId: adminUserId,
    actorRole: adminRole,
    action: 'KYC_AGE_DISCREPANCY_AUTO_FLAGGED',
    resourceType: 'KYCRequest',
    resourceId: String(kycRequest._id),
    metadata: {
      bypassDetected,
      discrepancyYears: ageResult?.discrepancyYears ?? null,
      tier: ageResult?.tier ?? null,
    },
    req,
  });

  return { success: true, outcome: 'age_flagged' };
}

async function rejectForDataMismatchAndCorrect({
  kycRequest,
  applicant,
  adminUserId,
  adminRole,
  documentDate,
  ageResult,
  req,
}) {
  kycRequest.status = 'rejected';
  kycRequest.age_discrepancy_years = ageResult.discrepancyYears;
  kycRequest.review_decision_reason = 'DATA_MISMATCH';
  kycRequest.reviewed_by_admin_id = adminUserId;
  kycRequest.reviewed_at = new Date();
  await kycRequest.save();

  await User.findByIdAndUpdate(applicant._id, {
    kyc_status: 'rejected',
    birth_date: documentDate,
  });

  await auditService.record({
    actorId: adminUserId,
    actorRole: adminRole,
    action: 'KYC_REJECTED_DATA_MISMATCH_BIRTHDATE_AUTOCORRECTED',
    resourceType: 'KYCRequest',
    resourceId: String(kycRequest._id),
    metadata: { discrepancyYears: ageResult.discrepancyYears, correctedBirthDate: documentDate },
    req,
  });

  return { success: true, outcome: 'rejected_autocorrected' };
}

async function approveAndSyncBirthDate({
  kycRequest,
  applicant,
  adminUserId,
  adminRole,
  documentDate,
  ageResult,
  optionalNote,
  req,
}) {
  kycRequest.status = 'verified';
  kycRequest.age_discrepancy_years = ageResult.discrepancyYears;
  kycRequest.review_decision_reason = optionalNote || null;
  kycRequest.reviewed_by_admin_id = adminUserId;
  kycRequest.reviewed_at = new Date();
  await kycRequest.save();

  // Auto-Sync: every approved Green/Yellow outcome updates the account's
  // birth_date to exactly match the verified document — the platform
  // holds the single source of truth going forward, not whatever was
  // typed at registration.
  await User.findByIdAndUpdate(applicant._id, {
    kyc_status: 'verified',
    birth_date: documentDate,
  });

  if (kycRequest.applicant_role === 'Instructor') {
    await grantInstructorPermissions({
      instructorUserId: applicant._id,
      reviewingAdminId: adminUserId,
      reviewingAdminRole: adminRole,
      req,
    });
  }

  await auditService.record({
    actorId: adminUserId,
    actorRole: adminRole,
    action: 'KYC_REQUEST_APPROVED',
    resourceType: 'KYCRequest',
    resourceId: String(kycRequest._id),
    metadata: {
      ageTier: ageResult.tier,
      discrepancyYears: ageResult.discrepancyYears,
      birthDateSynced: true,
    },
    req,
  });

  return { success: true, outcome: 'verified' };
}

async function approveKycRequest({
  kycRequestId,
  adminUserId,
  documentBirthDate,
  optionalNote,
  confirmYellowTier = false,
  req,
}) {
  const admin = await User.findById(adminUserId);
  if (!admin) {
    return { success: false, reason: 'ADMIN_NOT_FOUND' };
  }
  const adminRole = admin.role;

  const context = await getRequestForReview(kycRequestId);
  if (!context) {
    return { success: false, reason: 'REQUEST_NOT_FOUND_OR_NOT_PENDING' };
  }
  const { kycRequest, applicant } = context;

  const outcome = determineReviewOutcome({
    applicantRole: kycRequest.applicant_role,
    applicantBirthDate: applicant.birth_date,
    documentBirthDate,
    confirmYellowTier,
  });

  const ctx = { kycRequest, applicant, adminUserId, adminRole, req };

  switch (outcome.decision) {
    case 'HARD_REJECT_SUSPEND_MINOR_INSTRUCTOR':
      return hardRejectSuspendMinorInstructor(ctx);

    case 'FLAG_FOR_GUARDIAN_CORRECTION':
      return flagForGuardianCorrection({
        ...ctx,
        bypassDetected: outcome.bypassDetected,
        ageResult: outcome.ageResult,
      });

    case 'NEEDS_YELLOW_CONFIRMATION':
      return {
        success: false,
        reason: 'AGE_DISCREPANCY_REQUIRES_CONFIRMATION',
        tier: outcome.ageResult.tier,
        discrepancyYears: outcome.ageResult.discrepancyYears,
      };

    case 'REJECT_DATA_MISMATCH_AND_CORRECT':
      return rejectForDataMismatchAndCorrect({
        ...ctx,
        documentDate: outcome.documentDate,
        ageResult: outcome.ageResult,
      });

    case 'APPROVE_AND_SYNC':
      return approveAndSyncBirthDate({
        ...ctx,
        documentDate: outcome.documentDate,
        ageResult: outcome.ageResult,
        optionalNote,
      });

    default:
      throw new Error(`Unhandled KYC review decision: ${outcome.decision}`);
  }
}

async function rejectKycRequest({ kycRequestId, adminUserId, rejectionReason, req }) {
  if (!REJECTION_REASONS.includes(rejectionReason)) {
    return { success: false, reason: 'INVALID_REJECTION_REASON' };
  }

  const admin = await User.findById(adminUserId);
  if (!admin) {
    return { success: false, reason: 'ADMIN_NOT_FOUND' };
  }

  const context = await getRequestForReview(kycRequestId);
  if (!context) {
    return { success: false, reason: 'REQUEST_NOT_FOUND_OR_NOT_PENDING' };
  }
  const { kycRequest, applicant } = context;

  kycRequest.status = 'rejected';
  kycRequest.review_decision_reason = rejectionReason;
  kycRequest.reviewed_by_admin_id = adminUserId;
  kycRequest.reviewed_at = new Date();
  await kycRequest.save();

  await User.findByIdAndUpdate(applicant._id, { kyc_status: 'rejected' });

  await auditService.record({
    actorId: adminUserId,
    actorRole: admin.role,
    action: 'KYC_REQUEST_REJECTED',
    resourceType: 'KYCRequest',
    resourceId: String(kycRequest._id),
    metadata: { rejectionReason },
    req,
  });

  return { success: true };
}

module.exports = {
  getRequestForReview,
  determineReviewOutcome,
  approveKycRequest,
  rejectKycRequest,
  REJECTION_REASONS,
};
