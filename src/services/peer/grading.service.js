// src/services/peer/grading.service.js
// UC-PEER-04 — Calculate Final Peer Grade & Alert Instructor

const PeerAssignment = require('../../models/peerAssignment.model');
const PeerSubmission = require('../../models/peerSubmission.model');
const PeerReview = require('../../models/peerReview.model');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');
const auditService = require('../auditService');

// If the difference between the highest and lowest reviewer score exceeds 20%,
// the submission is flagged for instructor review.
const GRADE_VARIANCE_ALERT_THRESHOLD_PERCENT = 20;

/**
 * Calculate final grades for all submissions of a given assignment.
 *
 * This function can be called in two modes:
 * 1. lockAssignment = true  (default): Closes the assignment (status → 'completed')
 *    after grading. Used for synchronous courses or final course closure.
 * 2. lockAssignment = false : Calculates grades but keeps the assignment open
 *    ('distributed') for late-joining students. Used for self-paced (async) courses.
 *
 * It skips any submission that has been manually overridden by the instructor
 * (gradeOverridden = true) to preserve the instructor's decision.
 */
async function calculateFinalGrades({
  assignmentId,
  actorId = null,
  actorRole = 'System',
  req = null,
  lockAssignment = true,
}) {
  const safeAssignmentId = toObjectId(assignmentId, 'assignmentId');
  const assignment = await PeerAssignment.findById(safeAssignmentId);
  if (!assignment) {
    throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found.');
  }

  // If already completed, return early (idempotent).
  if (assignment.status === 'completed') {
    return { success: true, data: { assignment, alreadyCompleted: true } };
  }

  // Grading is only allowed after reviews have been distributed.
  if (assignment.status !== 'distributed') {
    throw new AppError(
      400,
      'NOT_DISTRIBUTED_YET',
      'Reviews have not been distributed for this assignment yet.'
    );
  }

  // If a review deadline exists and it hasn't passed, block grading.
  if (assignment.reviewDeadline && new Date() < assignment.reviewDeadline) {
    throw new AppError(400, 'REVIEW_STILL_OPEN', 'Review deadline has not yet passed.');
  }

  const submissions = await PeerSubmission.find({ assignmentId: safeAssignmentId });
  const flaggedSubmissionIds = [];
  const gradedSubmissionIds = []; // Submissions that actually received a numeric score.
  const bulkOps = [];

  for (const submission of submissions) {
    // === CRITICAL: Respect instructor overrides ===
    // If the instructor manually set this grade, we never recalculate it.
    // We still include it in gradedSubmissionIds so that progress is reconciled
    // (in case the progress event was missed during the original override).
    if (submission.gradeOverridden) {
      gradedSubmissionIds.push(submission._id);
      continue;
    }

    const reviews = await PeerReview.find({
      submissionId: submission._id,
      attemptNumber: submission.attemptNumber,
    }).lean();
    const completedReviews = reviews.filter((r) => r.status === 'completed');

    // Case 1: No completed reviews → flag for instructor attention.
    if (completedReviews.length === 0) {
      bulkOps.push({
        updateOne: {
          filter: { _id: submission._id },
          update: {
            $set: {
              finalScore: null,
              finalScorePercentage: null,
              gradingFlagged: true,
              gradingFlagReason: 'NO_REVIEWER_COMPLETED',
            },
          },
        },
      });
      flaggedSubmissionIds.push(submission._id.toString());
      continue;
    }

    // Case 2: At least one completed review → calculate the average.
    const scores = completedReviews.map((r) => r.totalScore);
    const average = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);
    const variancePercent = maxScore - minScore;

    // Flag if reviewer scores differ too much.
    const flagged = variancePercent > GRADE_VARIANCE_ALERT_THRESHOLD_PERCENT;

    bulkOps.push({
      updateOne: {
        filter: { _id: submission._id },
        update: {
          $set: {
            finalScore: Math.round(average * 100) / 100,
            finalScorePercentage: Math.round(average * 100) / 100,
            gradingFlagged: flagged,
            gradingFlagReason: flagged ? 'REVIEWER_VARIANCE_EXCEEDS_THRESHOLD' : null,
          },
        },
      },
    });

    gradedSubmissionIds.push(submission._id);
    if (flagged) {
      flaggedSubmissionIds.push(submission._id.toString());
    }
  }

  // Apply all grade updates in a single batch operation.
  if (bulkOps.length > 0) {
    await PeerSubmission.bulkWrite(bulkOps);
  }

  // ============================================================
  // LOCK BEHAVIOUR: The core differentiator between sync and async.
  // - lockAssignment = true  → closes the assignment (status = 'completed').
  // - lockAssignment = false → leaves it open ('distributed') for late joiners.
  // ============================================================
  if (lockAssignment) {
    assignment.status = 'completed';
    assignment.completedAt = new Date();
    await assignment.save();
  }
  // If lockAssignment is false, we DO NOT save the assignment,
  // keeping it in 'distributed' state intentionally.

  await auditService.record({
    actorId,
    actorRole,
    action: 'PEER_FINAL_GRADES_CALCULATED',
    resourceType: 'PeerAssignment',
    resourceId: safeAssignmentId.toString(),
    metadata: {
      submissionCount: submissions.length,
      flaggedCount: flaggedSubmissionIds.length,
      assignmentLocked: lockAssignment,
    },
    req,
  });

  // === Force progress reconciliation ===
  // For every submission that received a score (even if only 1 reviewer),
  // we force the progress service to mark the unit as complete.
  // This is critical because in async courses, the original threshold
  // (e.g., 2 reviews) might never be met, but the instructor has decided
  // to finalise the grade anyway.

  const progressService = require('../progress.service');
  for (const submissionId of gradedSubmissionIds) {
    try {
      await progressService.checkAndRecordPeerSubmissionCompletion({
        submissionId,
        req,
        forceFinal: true, // Bypasses the review threshold check.
      });
    } catch (err) {
      console.error(
        'Peer progress reconciliation after grading failed (non-critical):',
        err.message
      );
    }
  }

  // TODO(email): Notify the instructor with details for each flagged submission (UC-PEER-04 step 4).

  return {
    success: true,
    data: {
      assignment,
      submissionCount: submissions.length,
      flaggedSubmissionIds,
      assignmentLocked: lockAssignment,
    },
  };
}

/**
 * === INSTRUCTOR MANUAL OVERRIDE ===
 *
 * Allows an instructor to manually set the final grade for a specific submission.
 * This is the ultimate quality-control mechanism.
 *
 * Key behaviours:
 * - Permitted in ANY assignment status EXCEPT 'distributing' (to avoid race conditions).
 *   This means instructors can override grades even when the assignment is still 'open'
 *   (e.g., the "1 student" edge case) or 'distributed' (async courses that never close).
 * - Sets gradeOverridden = true, which permanently prevents ALL future auto-grading
 *   (batch calculations, event-driven updates, lazy safety nets) from touching this
 *   submission.
 * - Fully audited: stores who overrode it, when, the previous score, and the reason.
 * - Automatically reconciles course progress after the override.
 */
async function overrideSubmissionGrade({
  instructorId,
  assignmentId,
  submissionId,
  finalScorePercentage,
  reason,
  req,
}) {
  const safeAssignmentId = toObjectId(assignmentId, 'assignmentId');
  const safeSubmissionId = toObjectId(submissionId, 'submissionId');
  const safeInstructorId = toObjectId(instructorId, 'instructorId');

  // Load the assignment and verify that the instructor owns this course (prevents IDOR).
  const { loadOwnedAssignment } = require('./assignment.service');
  const assignment = await loadOwnedAssignment(safeAssignmentId, safeInstructorId, {
    req,
    unauthorizedAction: 'UNAUTHORIZED_PEER_GRADE_OVERRIDE_ATTEMPT',
  });

  // The ONLY state where we block an override is during active distribution.
  // This is a transient state (milliseconds) and the instructor can retry immediately.
  if (assignment.status === 'distributing') {
    throw new AppError(
      409,
      'DISTRIBUTION_IN_PROGRESS',
      'Cannot override a grade while distribution is in progress. Please retry shortly.'
    );
  }

  // Verify that the submission exists and belongs to this assignment.
  const submission = await PeerSubmission.findOne({
    _id: safeSubmissionId,
    assignmentId: safeAssignmentId,
  });
  if (!submission) {
    throw new AppError(404, 'SUBMISSION_NOT_FOUND', 'Submission not found for this assignment.');
  }

  const previousScore = submission.finalScorePercentage;

  // Apply the new grade and lock the submission against future auto-updates.
  submission.finalScore = finalScorePercentage;
  submission.finalScorePercentage = finalScorePercentage;
  submission.gradingFlagged = false; // Override clears any previous flags.
  submission.gradingFlagReason = 'INSTRUCTOR_OVERRIDE';
  submission.gradeOverridden = true; // PERMANENT LOCK: auto-grading will skip this forever.
  submission.overriddenBy = safeInstructorId;
  submission.overriddenAt = new Date();
  submission.overrideReason = reason || null;
  await submission.save();

  // Audit trail: essential for academic integrity and accountability.
  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'PEER_GRADE_MANUALLY_OVERRIDDEN',
    resourceType: 'PeerSubmission',
    resourceId: safeSubmissionId.toString(),
    metadata: {
      assignmentId: safeAssignmentId.toString(),
      previousScore,
      newScore: finalScorePercentage,
      reason: reason || null,
    },
    req,
  });

  // Reconcile course progress (idempotent, so it's safe to call even if already recorded).
  const progressService = require('../progress.service');
  try {
    await progressService.checkAndRecordPeerSubmissionCompletion({
      submissionId: safeSubmissionId,
      req,
      forceFinal: true,
    });
  } catch (err) {
    console.error(
      'Progress reconciliation after grade override failed (non-critical):',
      err.message
    );
  }

  return { success: true, data: { submission } };
}

/**
 * Get a grade summary for a student or instructor.
 *
 * For students: returns their own grade and the completed reviews they received.
 * For instructors: returns all submissions with student details and flags.
 */
async function getGradeSummary({ userId, role, assignmentId }) {
  const safeAssignmentId = toObjectId(assignmentId, 'assignmentId');
  const assignment = await PeerAssignment.findById(safeAssignmentId).lean();
  if (!assignment) {
    throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found.');
  }

  const { ensureAssignmentUpToDate } = require('./lifecycle.service');

  // --- Student view ---
  if (role === 'Student') {
    const submission = await PeerSubmission.findOne({
      assignmentId: safeAssignmentId,
      studentId: userId,
    }).lean();
    if (!submission) {
      throw new AppError(
        404,
        'SUBMISSION_NOT_FOUND',
        'You have no submission for this assignment.'
      );
    }

    // Lazy lifecycle check: ensures any pending distribution or grading is handled.
    const { pendingIssue } = await ensureAssignmentUpToDate({ assignment });
    const freshSubmission = await PeerSubmission.findById(submission._id).lean();

    const reviews = await PeerReview.find({
      submissionId: submission._id,
      status: 'completed',
    })
      .select('scores feedbackText totalScore')
      .lean();

    return {
      success: true,
      data: {
        finalScore: freshSubmission.finalScore,
        finalScorePercentage: freshSubmission.finalScorePercentage,
        reviews,
        ...(pendingIssue && { pendingIssue }),
      },
    };
  }

  // --- Instructor view ---
  if (role === 'Instructor' && assignment.instructorId.toString() !== userId.toString()) {
    throw new AppError(
      403,
      'FORBIDDEN',
      'You do not have permission to view grades for this assignment.'
    );
  }

  const { pendingIssue } = await ensureAssignmentUpToDate({ assignment });

  const submissions = await PeerSubmission.find({ assignmentId: safeAssignmentId })
    .populate('studentId', 'full_name email')
    .lean();

  return { success: true, data: { submissions, ...(pendingIssue && { pendingIssue }) } };
}

module.exports = {
  calculateFinalGrades,
  overrideSubmissionGrade,
  getGradeSummary,
  GRADE_VARIANCE_ALERT_THRESHOLD_PERCENT,
};
