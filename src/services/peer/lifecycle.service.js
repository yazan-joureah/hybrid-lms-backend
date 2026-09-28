// src/services/peer/lifecycle.service.js

const PeerAssignment = require('../../models/peerAssignment.model');
const PeerSubmission = require('../../models/peerSubmission.model');
const Course = require('../../models/Course');
const allocationService = require('./allocation.service');
const gradingService = require('./grading.service');

const { MIN_SUBMISSIONS_FOR_DISTRIBUTION } = require('./allocation.service');

const DISTRIBUTING_STUCK_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Ensures that a peer assignment is up to date with lifecycle transitions.
 */
async function ensureAssignmentUpToDate({ assignment, req = null }) {
  if (!assignment) return { assignment, pendingIssue: null };

  const now = new Date();

  try {
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

          if (result.data && result.data.assignment) {
            return { assignment: result.data.assignment, pendingIssue: null };
          }
        }
      }
    }

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

    if (assignment.status === 'distributed') {
      if (assignment.reviewDeadline && now > assignment.reviewDeadline) {
        const result = await gradingService.calculateFinalGrades({
          assignmentId: assignment._id,
          actorId: null,
          actorRole: 'System',
          lockAssignment: true,
          req,
        });
        return { assignment: result.data.assignment, pendingIssue: null };
      }

      await allocationService.topUpAllocation({ assignmentId: assignment._id, req });

      const ungradedSubmissions = await PeerSubmission.find({
        assignmentId: assignment._id,
        finalScore: null,
        gradeOverridden: false,
      })
        .select('_id')
        .lean();

      if (ungradedSubmissions.length > 0) {
        const progressService = require('../progress.service');
        for (const sub of ungradedSubmissions) {
          try {
            await progressService.checkAndRecordPeerSubmissionCompletion({
              submissionId: sub._id,
              req,
              forceFinal: false,
            });
          } catch (err) {
            console.error('Lazy peer auto-grade failed (non-critical):', sub._id, err.message);
          }
        }
      }
    }
  } catch (err) {
    return { assignment, pendingIssue: err.code || 'LIFECYCLE_CHECK_FAILED' };
  }

  return { assignment, pendingIssue: null };
}

module.exports = { ensureAssignmentUpToDate };
