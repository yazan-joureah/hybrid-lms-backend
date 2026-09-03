// src/services/kyc/kycReview.service.js
//
// UC-KYC-02 + EXT-KYC-01 (v2 — "Minor-First Firewall")
//
// SECURITY FIX (this session — supersedes the previous implementation):
// The ORIGINAL logic computed the discrepancy TIER first, and only
// checked minority as a side-effect of the tier being "red". Two
// critical flaws followed directly from that ordering:
//
//  1. An ADULT whose registered birth_date was simply mistyped by >2
//     years was being forced through the Guardian Approval flow — a
//     real 25-year-old should never need a guardian's email over a
//     data-entry typo.
//  2. Far more serious: a MINOR who registered claiming to be 18+ (to
//     bypass the guardian requirement at signup, MUC-AUTH-08/09) could
//     submit a KYC document revealing their true age, but if the
//     discrepancy between the FALSE registered date and the TRUE
//     document date happened to land ≤1 year, the system classified it
//     "green" and let an Admin approve it WITHOUT EVER checking the
//     applicant's real age — completely defeating minor protection.
//
// THE FIX: true age (from the Admin-verified documentBirthDate — the one
// server-side value this entire review process exists to establish) is
// checked FIRST, unconditionally, before any discrepancy math runs.
// Discrepancy tiering (Green/Yellow/Red) now only ever answers a
// narrower, LATER question — "is this specific person's own account
// data internally consistent?" — never "should minor protections
// apply?". That question is answered exclusively by the firewall below.
//
// References: FR-42, FR-45, FR-46, FR-48, FR-48b | MUC-KYC-01, MUC-KYC-03

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

// ---------------------------------------------------------------------------
// PURE decision function — no I/O, no DB writes, no side effects.
// Deliberately separated so it can be unit-tested exhaustively (every
// branch below) without touching Mongo at all — the highest-value tests
// in this whole module, given how much depends on getting this right.
// ---------------------------------------------------------------------------
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
    // Hard block: a minor cannot hold Instructor privileges under ANY
    // circumstance, guardian consent included (same rule already
    // enforced at registration — UC-AUTH-01 [8a] / oauth.service.js
    // MINOR_CANNOT_BE_INSTRUCTOR). No tier math is relevant here at all.
    if (applicantRole === 'Instructor') {
      return { decision: 'HARD_REJECT_SUSPEND_MINOR_INSTRUCTOR' };
    }

    // Bypass detection: the account claimed to be an adult at
    // registration (no guardian flow was ever completed for it), but
    // the verified document proves otherwise. Tier is IGNORED entirely
    // — even a 1-year "green" discrepancy is irrelevant once we know
    // the true age is under 18 and no guardian is on file.
    const registeredAsMinor = isMinor(applicantBirthDate);
    if (!registeredAsMinor) {
      return { decision: 'FLAG_FOR_GUARDIAN_CORRECTION', bypassDetected: true };
    }

    // Legitimate minor — guardian approval already exists on file from
    // registration. Still runs the "honesty" tier check below, but a
    // RED result here means "re-verify with the guardian", never the
    // adult's silent-auto-correct path (a >2yr gap for an existing
    // minor is unusual enough to warrant a fresh guardian confirmation,
    // not a one-line data fix).
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
    // The "clumsy adult": a genuine data-entry mistake >2 years off,
    // but definitively an adult. No guardian anywhere in this path —
    // standard rejection + silent self-service correction instead.
    return { decision: 'REJECT_DATA_MISMATCH_AND_CORRECT', ageResult, documentDate };
  }
  if (ageResult.tier === 'yellow' && !confirmYellowTier) {
    return { decision: 'NEEDS_YELLOW_CONFIRMATION', ageResult };
  }
  return { decision: 'APPROVE_AND_SYNC', ageResult, documentDate };
}

// ---------------------------------------------------------------------------
// DB-writing branch handlers — one per terminal decision. Kept separate
// so approveKycRequest() itself stays a short, readable dispatcher.
// ---------------------------------------------------------------------------

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

  // SECURITY: this is a fraud/misrepresentation attempt (falsely
  // claiming adulthood to obtain Instructor privileges), not an
  // ordinary account action — kill every live session/OAuth link
  // immediately, same mechanism already used for admin-suspended
  // accounts (accountRevocation.service.js), reused verbatim.
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
      bypassDetected, // true = account registered claiming adulthood, doc proved otherwise
      discrepancyYears: ageResult?.discrepancyYears ?? null,
      tier: ageResult?.tier ?? null,
    },
    req,
  });

  // Downstream: applicant.requestAgeCorrection() (ageCorrection.service.js)
  // — UNCHANGED, already correctly handles both bypassDetected and
  // legitimate-minor sub-cases identically (student supplies a guardian
  // email, GuardianApproval flow re-runs). No edit needed there.
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

  // Silent self-service correction — no guardian, no admin follow-up
  // step required. The applicant is a confirmed adult; the corrected
  // birth_date is exactly what UC-KYC-01's RESUBMITTABLE_KYC_STATUSES
  // already expects ('rejected' → resubmit immediately with new docs).
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

// ---------------------------------------------------------------------------
// Public entry point — thin dispatcher over determineReviewOutcome().
// ---------------------------------------------------------------------------
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
      // Unreachable — exhaustive switch over determineReviewOutcome()'s
      // fixed decision set. Thrown, not silently ignored, in case a
      // future branch is added to one without the other.
      throw new Error(`Unhandled KYC review decision: ${outcome.decision}`);
  }
}

/** UC-KYC-02 ext [b7] — unchanged, manual Admin rejection, classified reason. */
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
  determineReviewOutcome, // exported for direct pure-function unit testing
  approveKycRequest,
  rejectKycRequest,
  REJECTION_REASONS,
};
