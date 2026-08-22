// src/controllers/peer/grading.controller.js
// UC-PEER-04 — Calculate Final Peer Grade & Alert Instructor

const peerService = require('../../services/peerService');

/**
 * POST /api/v1/peer/assignments/:assignmentId/calculate-grades
 *
 * Manually triggers the final grading calculation for all submissions in an assignment.
 *
 * Query Parameter:
 *   ?lockAssignment=false  → Keeps the assignment in 'distributed' state after grading.
 *                            Used for asynchronous (self‑paced) courses where late
 *                            students may still join. The assignment remains open.
 *   ?lockAssignment=true (default) → Closes the assignment (status becomes 'completed')
 *                            after grading. Used for synchronous courses or when the
 *                            instructor wants to permanently close the assignment.
 *
 * This endpoint is a safety net; in normal operation, grading happens automatically
 * via the lifecycle service or event‑driven triggers.
 */
async function calculateGrades(req, res, next) {
  try {
    const { assignmentId } = req.params;
    // Default to locking (true) for synchronous courses.
    // Instructors can pass lockAssignment=false for async courses.
    const lockAssignment = req.query.lockAssignment !== 'false';
    const result = await peerService.calculateFinalGrades({
      assignmentId,
      actorId: req.user.id,
      actorRole: req.verifiedRole,
      lockAssignment,
      req,
    });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/peer/assignments/:assignmentId/grades
 *
 * Retrieves the grade summary for the current user (student or instructor).
 * - Students see their own grade and the peer reviews they received.
 * - Instructors see all submissions for the assignment, including student details,
 *   final scores, and flag statuses (e.g., variance alerts, no reviewers).
 *
 * The lifecycle service is called lazily to ensure the assignment is up to date
 * before returning the grade data.
 */
async function getGrades(req, res, next) {
  try {
    const { assignmentId } = req.params;
    const result = await peerService.getGradeSummary({
      userId: req.user.id,
      role: req.verifiedRole,
      assignmentId,
    });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

/**
 * PATCH /api/v1/peer/assignments/:assignmentId/submissions/:submissionId/override-grade
 *
 * Allows an instructor to manually override the final grade for a specific submission.
 * This is the ultimate quality‑control tool for edge cases such as:
 *   - Only 1 student submitted (no distribution possible, status stays 'open').
 *   - Peer reviewers disagree significantly (variance flagged).
 *   - No reviewers completed their task (NO_REVIEWER_COMPLETED flag).
 *
 * Once overridden, the submission's gradeOverridden flag is set to true,
 * permanently preventing any future auto‑grading (event‑driven, lazy, or batch)
 * from modifying this grade.
 *
 * Request Body:
 *   {
 *     "finalScorePercentage": 85.5,   // Required: 0‑100
 *     "reason": "Peer reviewer was overly harsh; student met all criteria." // Optional
 *   }
 *
 * Security: The instructor must own the course (validated via loadOwnedAssignment).
 * Full audit trail is recorded.
 */
async function overrideGrade(req, res, next) {
  try {
    const result = await peerService.overrideSubmissionGrade({
      instructorId: req.user.id,
      assignmentId: req.params.assignmentId,
      submissionId: req.params.submissionId,
      finalScorePercentage: req.body.finalScorePercentage,
      reason: req.body.reason,
      req,
    });
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  calculateGrades,
  getGrades,
  overrideGrade,
};
