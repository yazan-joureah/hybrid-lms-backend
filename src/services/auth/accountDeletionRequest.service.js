const User = require('../../models/User');
const AccountDeletionRequest = require('../../models/AccountDeletionRequest');
const Course = require('../../models/Course');
const Enrollment = require('../../models/Enrollment');
const { revokeAllSessionsAndOAuth } = require('./accountRevocation.service');
const auditService = require('../auditService');
const { AppError } = require('../../middleware/errorHandler');

/**
 * DELETE /auth/account.
 * Student → deleted immediately.
 * Instructor/Admin → creates a pending_review request for SuperAdmin.
 * SuperAdmin → blocked entirely.
 */
async function requestOwnAccountDeletion({ userId, reason, req }) {
  // Fetch the user to get role and verify existence/status
  const user = await User.findById(userId).select('role status');
  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User account does not exist.');
  }
  if (user.status === 'deleted') {
    throw new AppError(409, 'ALREADY_DELETED', 'Account is already deleted.');
  }

  const userRole = user.role;

  if (userRole === 'SuperAdmin') {
    throw new AppError(
      403,
      'FORBIDDEN',
      'A SuperAdmin account cannot be self-deleted through this endpoint.'
    );
  }

  const existingPending = await AccountDeletionRequest.findOne({
    user_id: userId,
    status: 'pending_review',
  });
  if (existingPending) {
    throw new AppError(
      409,
      'REQUEST_ALREADY_PENDING',
      'A deletion request is already pending review.'
    );
  }

  if (userRole === 'Student') {
    const activeEnrollmentCount = await Enrollment.countDocuments({
      student_id: userId,
      status: 'active',
    });
    if (activeEnrollmentCount > 0) {
      throw new AppError(
        409,
        'STUDENT_HAS_ACTIVE_ENROLLMENTS',
        'Cancel or refund your active enrollments before deleting your account.'
      );
    }

    await User.updateOne({ _id: userId }, { $set: { status: 'deleted', deleted_at: new Date() } });

    await revokeAllSessionsAndOAuth({
      userId,
      reason: reason || 'SELF_DELETION_REQUESTED',
      triggeredByAdminId: null,
      req,
    });

    await auditService.record({
      actorId: userId,
      actorRole: userRole,
      action: 'ACCOUNT_SELF_DELETED_IMMEDIATE',
      resourceType: 'user',
      resourceId: userId,
      metadata: { reason },
      req,
    });

    return { error: null, immediate: true, status: 'deleted' };
  }

  // Instructor/Admin — requires SuperAdmin approval.
  if (userRole === 'Instructor') {
    const activeCourseCount = await Course.countDocuments({
      owner_instructor_id: userId,
      status: { $ne: 'archived' },
    });
    if (activeCourseCount > 0) {
      throw new AppError(
        409,
        'INSTRUCTOR_HAS_ACTIVE_COURSES',
        'Archive all your courses before requesting account deletion.'
      );
    }
  }

  const request = await AccountDeletionRequest.create({ user_id: userId, reason });

  await auditService.record({
    actorId: userId,
    actorRole: userRole,
    action: 'ACCOUNT_DELETION_REQUESTED',
    resourceType: 'account_deletion_request',
    resourceId: request._id,
    metadata: { reason },
    req,
  });

  return { error: null, immediate: false, requestId: request._id, status: 'pending_review' };
}

/**
 * POST /admin/deletion-requests/:id/review — SuperAdmin decision.
 */
async function reviewDeletionRequest({ reviewerId, requestId, decision, decisionReason, req }) {
  const request = await AccountDeletionRequest.findById(requestId);
  if (!request) {
    throw new AppError(404, 'REQUEST_NOT_FOUND', 'Deletion request not found.');
  }
  if (request.status !== 'pending_review') {
    throw new AppError(409, 'REQUEST_ALREADY_DECIDED', 'This request has already been reviewed.');
  }

  request.status = decision === 'approve' ? 'approved' : 'rejected';
  request.reviewer_id = reviewerId;
  request.decision_reason = decisionReason || null;
  request.reviewed_at = new Date();
  await request.save();

  if (decision === 'approve') {
    await User.updateOne(
      { _id: request.user_id },
      { $set: { status: 'deleted', deleted_at: new Date() } }
    );

    await revokeAllSessionsAndOAuth({
      userId: request.user_id,
      reason: 'SELF_DELETION_APPROVED',
      triggeredByAdminId: reviewerId,
      req,
    });
  }

  await auditService.record({
    actorId: reviewerId,
    actorRole: 'SuperAdmin',
    action: decision === 'approve' ? 'DELETION_REQUEST_APPROVED' : 'DELETION_REQUEST_REJECTED',
    resourceType: 'account_deletion_request',
    resourceId: request._id,
    metadata: { decision_reason: decisionReason, target_user_id: request.user_id },
    req,
  });

  return { error: null, status: request.status };
}

module.exports = { requestOwnAccountDeletion, reviewDeletionRequest };
