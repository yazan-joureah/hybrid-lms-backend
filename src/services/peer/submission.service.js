// src/services/peer/submission.service.js

const PeerAssignment = require('../../models/peerAssignment.model');
const PeerSubmission = require('../../models/peerSubmission.model');
const PeerReview = require('../../models/peerReview.model');
const Enrollment = require('../../models/Enrollment');
const Course = require('../../models/Course');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');
const fileStorage = require('../fileStorage.service');
const auditService = require('../auditService');
const allocationService = require('./allocation.service');
const { PEER_SUBMISSION_POLICY } = require('../../config/uploadPolicies');

async function submitAssignment({ studentId, assignmentId, textContent, file, req }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeAssignmentId = toObjectId(assignmentId, 'assignmentId');

  const assignment = await PeerAssignment.findById(safeAssignmentId);
  if (!assignment) {
    throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found.');
  }

  const course = await Course.findById(assignment.courseId).select('is_synchronous').lean();
  const isAsync = Boolean(course && !course.is_synchronous);

  const existingSubmission = await PeerSubmission.findOne({
    assignmentId: safeAssignmentId,
    studentId: safeStudentId,
  })
    .select('storagePath finalScore gradeOverridden attemptNumber')
    .lean();

  const currentAttempt = existingSubmission?.attemptNumber || 1;
  const isGraded = Boolean(
    existingSubmission &&
    (existingSubmission.finalScore !== null || existingSubmission.gradeOverridden)
  );

  // ============================================================
  // Retry is allowed ONLY for asynchronous courses.
  // In synchronous courses, once graded, no more submissions.
  // ============================================================
  const isRetry = isGraded && assignment.status === 'distributed' && isAsync;

  // ============================================================
  // Gate 1 — Normal time‑based gates (skipped entirely for retries)
  // ============================================================
  if (!isRetry) {
    if (assignment.status === 'open') {
      if (assignment.submissionDeadline && new Date() > assignment.submissionDeadline) {
        throw new AppError(400, 'SUBMISSION_DEADLINE_PASSED', 'Submission deadline has passed.');
      }
    } else if (assignment.status === 'distributed' && isAsync) {
      // Only async courses allow late submissions before the review deadline
      if (assignment.reviewDeadline && new Date() > assignment.reviewDeadline) {
        throw new AppError(400, 'SUBMISSION_DEADLINE_PASSED', 'Submission deadline has passed.');
      }
    } else {
      throw new AppError(400, 'SUBMISSIONS_CLOSED', 'Submissions are closed for this assignment.');
    }
  } else {
    // ============================================================
    // Gate 2 — Retry‑specific: only attempts limit applies
    // (this only runs for async courses)
    // ============================================================
    if (currentAttempt >= assignment.maxAttempts) {
      throw new AppError(
        403,
        'ATTEMPTS_EXHAUSTED',
        `You have used all ${assignment.maxAttempts} submission attempt(s) for this assignment.`
      );
    }
  }

  const enrolled = await Enrollment.findOne({
    student_id: safeStudentId,
    course_id: assignment.courseId,
    status: 'active',
  }).lean();

  if (!enrolled) {
    await auditService.record({
      actorId: safeStudentId,
      actorRole: 'Student',
      action: 'PEER_SUBMISSION_UNAUTHORIZED_ATTEMPT',
      resourceType: 'PeerAssignment',
      resourceId: safeAssignmentId.toString(),
      metadata: {},
      req,
    });
    throw new AppError(
      403,
      'NOT_ENROLLED',
      'You are not enrolled in the course for this assignment.'
    );
  }

  if (!textContent && !file) {
    throw new AppError(400, 'EMPTY_SUBMISSION', 'You must provide text content or a file.');
  }

  // ============================================================
  // Prevent editing once any reviewer has already evaluated the current attempt
  // (even if final grade isn't calculated yet)
  // ============================================================
  if (existingSubmission && !isGraded) {
    const anyReviewStarted = await PeerReview.exists({
      submissionId: existingSubmission._id,
      attemptNumber: currentAttempt,
      status: 'completed',
    });
    if (anyReviewStarted) {
      throw new AppError(
        409,
        'REVIEW_IN_PROGRESS',
        'You cannot edit your submission — at least one reviewer has already evaluated it. Please wait for grading to complete.'
      );
    }
  }

  // Honour instructor's decision about file uploads
  if (file && assignment.allowFileSubmission === false) {
    throw new AppError(
      400,
      'FILE_SUBMISSION_NOT_ALLOWED',
      'This assignment only accepts text submissions; file uploads are not allowed.'
    );
  }

  const isLateJoin = !existingSubmission && assignment.status === 'distributed';

  const update = {
    assignmentId: safeAssignmentId,
    studentId: safeStudentId,
    courseId: assignment.courseId,
    submittedAt: new Date(),
  };

  if (isRetry) {
    update.attemptNumber = currentAttempt + 1;
    // Reset all grading‑related fields
    update.finalScore = null;
    update.finalScorePercentage = null;
    update.gradingFlagged = false;
    update.gradingFlagReason = null;
    update.gradeOverridden = false;
    update.overriddenBy = null;
    update.overriddenAt = null;
    update.overrideReason = null;
    update.displaySequentialId = null;
  } else if (!existingSubmission) {
    // First‑time submission: set attemptNumber = 1 (default on insert)
    update.attemptNumber = 1;
  }

  if (textContent) update.textContent = textContent;

  if (file && file.buffer) {
    const { fileId, storagePath } = await fileStorage.replaceFile({
      file,
      previousStoragePath: existingSubmission?.storagePath || null,
      ...PEER_SUBMISSION_POLICY,
      userId: safeStudentId,
      actorRole: 'Student',
      req,
      metadata: { assignmentId: safeAssignmentId.toString(), context: 'peer_submission' },
    });
    update.fileId = fileId;
    update.storagePath = storagePath;
  }

  const submission = await PeerSubmission.findOneAndUpdate(
    { assignmentId: safeAssignmentId, studentId: safeStudentId },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await auditService.record({
    actorId: safeStudentId,
    actorRole: 'Student',
    action: 'PEER_ASSIGNMENT_SUBMITTED',
    resourceType: 'PeerAssignment',
    resourceId: safeAssignmentId.toString(),
    metadata: {
      submissionId: submission._id.toString(),
      hasFile: Boolean(file),
      isLateJoin,
      isRetry,
    },
    req,
  });

  if (isLateJoin) {
    try {
      await allocationService.topUpAllocation({ assignmentId: safeAssignmentId, req });
    } catch (err) {
      console.error(
        'Peer top-up allocation failed (non-critical, will retry lazily):',
        err.message
      );
    }
  } else if (isRetry) {
    try {
      await allocationService.reallocateReviewersForRetry({
        assignmentId: safeAssignmentId,
        submissionId: submission._id,
        req,
      });
    } catch (err) {
      console.error(
        'Peer retry reallocation failed (non-critical, will retry lazily):',
        err.message
      );
    }
  }

  return { success: true, data: { submission } };
}

async function listSubmissionsForInstructor({ instructorId, assignmentId }) {
  const safeAssignmentId = toObjectId(assignmentId, 'assignmentId');
  const safeInstructorId = toObjectId(instructorId, 'instructorId');

  const assignment = await PeerAssignment.findById(safeAssignmentId).lean();
  if (!assignment) {
    throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found.');
  }
  if (assignment.instructorId.toString() !== safeInstructorId.toString()) {
    throw new AppError(
      403,
      'FORBIDDEN',
      'You do not have permission to view submissions for this assignment.'
    );
  }

  const submissions = await PeerSubmission.find({ assignmentId: safeAssignmentId })
    .populate('studentId', 'full_name email')
    .select('-textContent')
    .sort({ submittedAt: 1 })
    .lean();

  return {
    success: true,
    data: { submissions, submissionCount: submissions.length },
  };
}

async function getMySubmission({ studentId, assignmentId }) {
  const safeAssignmentId = toObjectId(assignmentId, 'assignmentId');
  const submission = await PeerSubmission.findOne({
    assignmentId: safeAssignmentId,
    studentId,
  }).lean();

  if (!submission) {
    return { success: true, data: { submission: null } };
  }

  const assignedReviews = await PeerReview.find({ submissionId: submission._id })
    .select('status')
    .lean();
  const completedCount = assignedReviews.filter((r) => r.status === 'completed').length;
  const threshold = Math.min(3, assignedReviews.length);

  return {
    success: true,
    data: {
      submission,
      reviewProgress: {
        reviewsReceived: completedCount,
        reviewsAssigned: assignedReviews.length,
        threshold,
        isComplete: threshold > 0 && completedCount >= threshold,
      },
    },
  };
}

module.exports = {
  submitAssignment,
  listSubmissionsForInstructor,
  getMySubmission,
  PEER_SUBMISSION_POLICY: require('../../config/uploadPolicies').PEER_SUBMISSION_POLICY,
};
