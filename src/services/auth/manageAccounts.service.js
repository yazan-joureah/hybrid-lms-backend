const User = require('../../models/User');
const AuthToken = require('../../models/AuthToken');
const Course = require('../../models/Course');
const Enrollment = require('../../models/Enrollment');
const { revokeAllSessionsAndOAuth } = require('./accountRevocation.service');
const auditService = require('../auditService');
const { AppError } = require('../../middleware/errorHandler');
const { generateNumericOtp } = require('../../utils/crypto');
const emailService = require('../emailService');
const logger = require('../../utils/logger');

const ADMIN_SETUP_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes, consistent with password reset

function assertCanManageTarget({ actorRole, targetRole }) {
  if (targetRole === 'SuperAdmin') {
    throw new AppError(
      403,
      'FORBIDDEN',
      'SuperAdmin accounts cannot be managed through this endpoint.'
    );
  }
  if (targetRole === 'Admin' && actorRole !== 'SuperAdmin') {
    throw new AppError(403, 'FORBIDDEN', 'Only a SuperAdmin can manage another Admin account.');
  }
}

/**
 * POST /admin/accounts/:id/status
 * action: 'suspend' | 'activate'. `reason` is mandatory
 */
async function setAccountStatus({ actorId, actorRole, targetUserId, action, reason, req }) {
  const targetUser = await User.findById(targetUserId).select('role status');
  if (!targetUser) {
    throw new AppError(404, 'USER_NOT_FOUND', 'Target account does not exist.');
  }

  assertCanManageTarget({ actorRole, targetRole: targetUser.role });

  if (String(targetUser._id) === String(actorId)) {
    throw new AppError(
      400,
      'SELF_ACTION_NOT_ALLOWED',
      'You cannot suspend or activate your own account through this endpoint.'
    );
  }

  const newStatus = action === 'suspend' ? 'suspended' : 'active';

  if (targetUser.status === newStatus) {
    throw new AppError(409, 'STATUS_UNCHANGED', `Account is already ${newStatus}.`);
  }

  targetUser.status = newStatus;
  await targetUser.save();

  if (action === 'suspend') {
    await revokeAllSessionsAndOAuth({
      userId: targetUser._id,
      reason,
      triggeredByAdminId: actorId,
      req,
    });
  }

  await auditService.record({
    actorId,
    actorRole,
    action: action === 'suspend' ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_ACTIVATED',
    resourceType: 'user',
    resourceId: targetUser._id,
    metadata: { reason, target_role: targetUser.role },
    req,
  });

  return { error: null, status: targetUser.status };
}

/**
 * POST /admin/accounts – UC-AUTH-08.3.
 * SuperAdmin‑only creation of an Admin account.
 * The route MUST enforce `requireRole('SuperAdmin')`; this function also double‑checks.
 */
async function createAdminAccount({ actorId, actorRole, email, fullName, req }) {
  // Extra safety: only SuperAdmin may call this
  if (actorRole !== 'SuperAdmin') {
    throw new AppError(403, 'FORBIDDEN', 'Only SuperAdmin can create Admin accounts.');
  }

  const existing = await User.findOne({ email });
  if (existing) {
    throw new AppError(
      409,
      'EMAIL_ALREADY_REGISTERED',
      'An account with this email already exists.'
    );
  }

  const newAdmin = await User.create({
    full_name: fullName,
    email,
    password_hash: null,
    role: 'Admin',
    status: 'active',
    email_verified_at: new Date(), // created by a trusted party – no public verification flow needed
  });

  const { raw: code, hash } = generateNumericOtp();
  await AuthToken.create({
    user_id: newAdmin._id,
    token_hash: hash,
    token_type: 'PASSWORD_RESET',
    expires_at: new Date(Date.now() + ADMIN_SETUP_TOKEN_TTL_MS),
  });

  try {
    await emailService.sendAdminAccountCreatedEmail(newAdmin.email, code);
  } catch (err) {
    // Account is created; email failure is logged but does not block the operation
    logger.error('Admin account creation email failed to send — account still created', {
      newAdminId: newAdmin._id,
      error: err.message,
    });
  }

  await auditService.record({
    actorId,
    actorRole,
    action: 'ADMIN_ACCOUNT_CREATED',
    resourceType: 'user',
    resourceId: newAdmin._id,
    metadata: { created_admin_email: newAdmin.email },
    req,
  });

  return { error: null, adminId: newAdmin._id };
}

/**
 * POST /admin/accounts/:id – UC-AUTH-08.4 + 08.5.
 * Deletion here means the User document is soft-deleted (status='deleted',
 * deleted_at=now) — NOT anonymized yet. Anonymization (full_name/email →
 * "Deleted User [id]") happens via a separate scheduled job after the
 * 30-day restore window (per decision #12/#17 — out of scope for this
 * synchronous request/response flow).
 */
async function deleteAccount({ actorId, actorRole, targetUserId, reason, req }) {
  const targetUser = await User.findById(targetUserId).select('role status full_name email');
  if (!targetUser) {
    throw new AppError(404, 'USER_NOT_FOUND', 'Target account does not exist.');
  }

  assertCanManageTarget({ actorRole, targetRole: targetUser.role });

  if (String(targetUser._id) === String(actorId)) {
    throw new AppError(
      400,
      'SELF_ACTION_NOT_ALLOWED',
      'Use the self-deletion request endpoint to delete your own account.'
    );
  }

  if (targetUser.status === 'deleted') {
    throw new AppError(409, 'ALREADY_DELETED', 'Account is already deleted.');
  }

  if (targetUser.role === 'Instructor') {
    const activeCourseCount = await Course.countDocuments({
      owner_instructor_id: targetUser._id,
      status: { $ne: 'archived' },
    });
    if (activeCourseCount > 0) {
      throw new AppError(
        409,
        'INSTRUCTOR_HAS_ACTIVE_COURSES',
        'This instructor has courses that are not archived yet. Archive all courses before deleting the account.'
      );
    }
  }

  if (targetUser.role === 'Student') {
    const activeEnrollmentCount = await Enrollment.countDocuments({
      student_id: targetUser._id,
      status: 'active',
    });
    if (activeEnrollmentCount > 0) {
      throw new AppError(
        409,
        'STUDENT_HAS_ACTIVE_ENROLLMENTS',
        'This student has active enrollments. Cancel or refund them before deleting the account.'
      );
    }
  }

  targetUser.status = 'deleted';
  targetUser.deleted_at = new Date();
  await targetUser.save();

  await revokeAllSessionsAndOAuth({
    userId: targetUser._id,
    reason: reason || 'ACCOUNT_DELETED_BY_ADMIN',
    triggeredByAdminId: actorId,
    req,
  });

  await auditService.record({
    actorId,
    actorRole,
    action: 'ACCOUNT_DELETED',
    resourceType: 'user',
    resourceId: targetUser._id,
    metadata: { reason, target_role: targetUser.role },
    req,
  });

  return { error: null, status: 'deleted', restoreWindowDays: 30 };
}

module.exports = {
  setAccountStatus,
  createAdminAccount,
  deleteAccount,
  assertCanManageTarget,
};
