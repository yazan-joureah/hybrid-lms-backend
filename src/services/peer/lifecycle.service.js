// src/services/peer/lifecycle.service.js
// Lazy check for peer assignment lifecycle — alternative to node-cron because
// Render's Free Tier puts the dyno to sleep during idle, so scheduled jobs never run.

const PeerAssignment = require('../../models/peerAssignment.model');
const PeerSubmission = require('../../models/peerSubmission.model');
const Course = require('../../models/Course');
const allocationService = require('./allocation.service');
const gradingService = require('./grading.service');

// Import the minimum number of submissions required for distribution.
const { MIN_SUBMISSIONS_FOR_DISTRIBUTION } = require('./allocation.service');

// If the task remains in 'distributing' longer than this (previous failure without executing the rollback,
// e.g., server crash mid‑distribution), we consider it stuck and safely revert it to 'open'.
const DISTRIBUTING_STUCK_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Ensures that a peer assignment is up to date with lifecycle transitions.
 * This function is called lazily every time an assignment is accessed (viewed, submitted, etc.).
 *
 * It handles:
 * 1. Recovery from stuck 'distributing' state (crash recovery).
 * 2. Auto-distribution for asynchronous courses when submission count reaches the threshold.
 * 3. Deadline-based distribution for synchronous courses.
 * 4. Rolling top‑up for late‑joining students in async courses.
 * 5. Lazy auto‑grading for submissions that might have missed the event‑driven trigger.
 * 6. Final grading and locking when a review deadline is reached.
 *
 * @param {Object} params
 * @param {Object} params.assignment - The peer assignment document (may be stale).
 * @param {Object|null} params.req - Optional Express request object (for logging/audit).
 * @returns {Promise<{ assignment: Object, pendingIssue: string | null }>}
 */
async function ensureAssignmentUpToDate({ assignment, req = null }) {
  if (!assignment) return { assignment, pendingIssue: null };

  const now = new Date();

  try {
    // ============================================================
    // 1. Recovery: stuck 'distributing' → revert to 'open'
    //    If the status is 'distributing' and it hasn't been updated for more than
    //    DISTRIBUTING_STUCK_TIMEOUT_MS, assume the distribution process crashed
    //    and roll back to 'open' so that the next trigger can try again.
    // ============================================================
    if (
      assignment.status === 'distributing' &&
      assignment.updatedAt &&
      now.getTime() - new Date(assignment.updatedAt).getTime() > DISTRIBUTING_STUCK_TIMEOUT_MS
    ) {
      await PeerAssignment.updateOne(
        { _id: assignment._id, status: 'distributing' },
        { $set: { status: 'open' } }
      );
      return { assignment: { ...assignment, status: 'open' }, pendingIssue: null };
    }

    // ============================================================
    // 2. Auto‑distribution for asynchronous (self‑paced) courses
    //    Triggered when assignment is 'open' AND course.is_synchronous === false
    //    AND the number of submissions reaches MIN_SUBMISSIONS_FOR_DISTRIBUTION (3).
    //    This enables early peer review distribution without waiting for a fixed deadline.
    // ============================================================
    if (assignment.status === 'open') {
      const course = await Course.findById(assignment.courseId).select('is_synchronous').lean();
      const isAsync = course && !course.is_synchronous;

      if (isAsync) {
        const submissionCount = await PeerSubmission.countDocuments({
          assignmentId: assignment._id,
        });

        if (submissionCount >= MIN_SUBMISSIONS_FOR_DISTRIBUTION) {
          const result = await allocationService.distributeReviews({
            assignmentId: assignment._id,
            actorId: null,
            actorRole: 'System',
            req,
          });
          // If distribution succeeded, return the updated assignment immediately
          // to avoid running further checks on the old state.
          if (result.data && result.data.assignment) {
            return { assignment: result.data.assignment, pendingIssue: null };
          }
        }
      }
    }

    // ============================================================
    // 3. Deadline‑based distribution for synchronous courses
    //    Triggered when assignment is 'open' and submissionDeadline has passed.
    //    This is the traditional behaviour for courses with a fixed submission deadline.
    // ============================================================
    if (
      assignment.status === 'open' &&
      assignment.submissionDeadline &&
      now > assignment.submissionDeadline
    ) {
      const result = await allocationService.distributeReviews({
        assignmentId: assignment._id,
        actorId: null,
        actorRole: 'System',
        req,
      });
      return { assignment: result.data.assignment, pendingIssue: null };
    }

    // ============================================================
    // 4. Handle 'distributed' state: top‑up, lazy grading, and final locking
    // ============================================================
    if (assignment.status === 'distributed') {
      // 4a. If a review deadline exists and it has passed, finalise grading and lock.
      //     This prevents further submissions or changes and calculates final scores.
      if (assignment.reviewDeadline && now > assignment.reviewDeadline) {
        const result = await gradingService.calculateFinalGrades({
          assignmentId: assignment._id,
          actorId: null,
          actorRole: 'System',
          lockAssignment: true, // Always lock when a deadline passes.
          req,
        });
        return { assignment: result.data.assignment, pendingIssue: null };
      }

      // 4b. Rolling top‑up: catch any late submissions (after distribution)
      //     from asynchronous courses and add them to the review pool.
      //     This is a cheap operation that returns null immediately if nothing is new.
      //     It ensures that students who submit later still get reviews assigned.
      await allocationService.topUpAllocation({ assignmentId: assignment._id, req });

      // 4c. Lazy auto‑grading (safety net for async courses with no reviewDeadline).
      //     This catches any submission that:
      //       - belongs to this assignment,
      //       - does not yet have a finalScore (ungraded),
      //       - has NOT been manually overridden by the instructor.
      //     It calls the progress service with forceFinal=false, meaning it will only
      //     grade submissions that have already met the review threshold (e.g., 2 completed reviews).
      //     This protects against missed event‑driven grading (e.g., server crash after a review submission).
      const ungradedSubmissions = await PeerSubmission.find({
        assignmentId: assignment._id,
        finalScore: null,
        gradeOverridden: false,
      })
        .select('_id')
        .lean();

      if (ungradedSubmissions.length > 0) {
        const progressService = require('../progress.service'); // lazy require to avoid circular dependency
        for (const sub of ungradedSubmissions) {
          try {
            await progressService.checkAndRecordPeerSubmissionCompletion({
              submissionId: sub._id,
              req,
              forceFinal: false, // Only grade if threshold is met; do not force for incomplete reviews.
            });
          } catch (err) {
            console.error('Lazy peer auto-grade failed (non-critical):', sub._id, err.message);
          }
        }
      }
    }
  } catch (err) {
    // Return the assignment along with an error code so the caller can decide how to handle it.
    // The pendingIssue can be used to show a warning to the user or to retry later.
    return { assignment, pendingIssue: err.code || 'LIFECYCLE_CHECK_FAILED' };
  }

  // No pending issues detected.
  return { assignment, pendingIssue: null };
}

module.exports = { ensureAssignmentUpToDate };
