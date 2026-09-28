const User = require('../../models/User');
const GuardianApproval = require('../../models/GuardianApproval');
const { sha256, generateOpaqueToken } = require('../../utils/crypto');
const emailService = require('../emailService');
const auditService = require('../auditService');
const logger = require('../../utils/logger');
const { AppError } = require('../../middleware/errorHandler');
const env = require('../../config/env');

const MAX_RESEND_COUNT = 5;
const GUARDIAN_APPROVAL_TTL_HOURS = 48;

async function loadPendingApprovalByStudentToken(rawToken) {
  const tokenHash = sha256(rawToken);
  const approval = await GuardianApproval.findOne({ student_access_token_hash: tokenHash });

  if (!approval) {
    throw new AppError(404, 'TOKEN_INVALID', 'Invalid or unknown management link.');
  }
  if (approval.status === 'pending' && approval.expires_at < new Date()) {
    approval.status = 'expired';
    await approval.save();
  }
  return approval;
}

/** GET /auth/guardian/manage?token=... — read-only status for the frontend page. */
async function getGuardianApprovalStatus({ rawToken }) {
  const approval = await loadPendingApprovalByStudentToken(rawToken);
  return {
    error: null,
    status: approval.status,
    guardianEmail: approval.guardian_email,
    expiresAt: approval.expires_at,
    resendCount: approval.resend_count,
    maxResendCount: MAX_RESEND_COUNT,
  };
}

/** POST /auth/guardian/manage/resend — re-sends to the SAME guardian address. */
async function resendGuardianApproval({ rawToken, req }) {
  const approval = await loadPendingApprovalByStudentToken(rawToken);

  if (approval.status !== 'pending') {
    throw new AppError(
      409,
      'NOT_PENDING',
      `This request is already ${approval.status} and can no longer be resent.`
    );
  }
  if (approval.resend_count >= MAX_RESEND_COUNT) {
    throw new AppError(
      429,
      'TOO_MANY_RESENDS',
      'You have reached the maximum number of resend attempts. Please contact support.'
    );
  }

  const { raw: approvalRaw, hash: approvalHash } = generateOpaqueToken();
  approval.approval_token_hash = approvalHash;
  approval.resend_count += 1;
  approval.expires_at = new Date(Date.now() + GUARDIAN_APPROVAL_TTL_HOURS * 60 * 60 * 1000);
  await approval.save();

  const user = await User.findById(approval.user_id).select('full_name');
  const approveUrl = `${env.frontUrl}/auth/guardian/approve?token=${approvalRaw}`;

  try {
    await emailService.sendGuardianApprovalEmail(
      approval.guardian_email,
      approveUrl,
      user?.full_name
    );
  } catch (err) {
    logger.error('Guardian approval resend email failed to send', {
      approvalId: approval._id,
      error: err.message,
    });
  }

  await auditService.record({
    actorId: approval.user_id,
    actorRole: 'System',
    action: 'GUARDIAN_APPROVAL_RESENT',
    resourceType: 'guardian_approval',
    resourceId: approval._id,
    metadata: { resend_count: approval.resend_count },
    req,
  });

  return { error: null, resendCount: approval.resend_count };
}

/** POST /auth/guardian/manage/update-email — corrects a mistyped guardian address. */
async function updateGuardianEmail({ rawToken, newGuardianEmail, req }) {
  const approval = await loadPendingApprovalByStudentToken(rawToken);

  if (approval.status !== 'pending') {
    throw new AppError(
      409,
      'NOT_PENDING',
      `This request is already ${approval.status} and the guardian email can no longer be changed.`
    );
  }

  const user = await User.findById(approval.user_id).select('full_name email');
  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'Associated account no longer exists.');
  }

  if (newGuardianEmail.toLowerCase() === user.email?.toLowerCase()) {
    throw new AppError(
      400,
      'GUARDIAN_EMAIL_SAME_AS_STUDENT',
      'Guardian email must differ from your own email.'
    );
  }

  const { raw: approvalRaw, hash: approvalHash } = generateOpaqueToken();
  approval.guardian_email = newGuardianEmail;
  approval.approval_token_hash = approvalHash;
  approval.expires_at = new Date(Date.now() + GUARDIAN_APPROVAL_TTL_HOURS * 60 * 60 * 1000);
  approval.resend_count = 0;
  await approval.save();

  const approveUrl = `${env.frontUrl}/auth/guardian/approve?token=${approvalRaw}`;

  try {
    await emailService.sendGuardianApprovalEmail(newGuardianEmail, approveUrl, user.full_name);
  } catch (err) {
    logger.error('Guardian approval email failed to send after email update', {
      approvalId: approval._id,
      error: err.message,
    });
  }

  await auditService.record({
    actorId: approval.user_id,
    actorRole: 'System',
    action: 'GUARDIAN_EMAIL_UPDATED',
    resourceType: 'guardian_approval',
    resourceId: approval._id,
    req,
  });

  return { error: null, guardianEmail: approval.guardian_email };
}

module.exports = { getGuardianApprovalStatus, resendGuardianApproval, updateGuardianEmail };
