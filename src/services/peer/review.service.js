// src/services/peer/review.service.js

const PeerReview = require('../../models/peerReview.model');
const PeerAssignment = require('../../models/peerAssignment.model');
const PeerSubmission = require('../../models/peerSubmission.model'); // NEW: needed for timeline view
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');
const fileStorage = require('../fileStorage.service');
const auditService = require('../auditService');

/**
 * Shows the student the list of review tasks assigned to them
 * for a specific assignment, without revealing the identity of the author.
 */
async function listMyReviewTasks({ reviewerId, assignmentId }) {
  const safeAssignmentId = toObjectId(assignmentId, 'assignmentId');
  const safeReviewerId = toObjectId(reviewerId, 'reviewerId');

  const { ensureAssignmentUpToDate } = require('./lifecycle.service');
  const assignment = await PeerAssignment.findById(safeAssignmentId).lean();

  if (assignment) await ensureAssignmentUpToDate({ assignment });

  const reviews = await PeerReview.find({
    assignmentId: safeAssignmentId,
    reviewerId: safeReviewerId,
  })
    .populate({ path: 'submissionId', select: 'displaySequentialId submittedAt' })
    .sort({ createdAt: 1 })
    .lean();

  const sanitized = reviews.map((r) => ({
    reviewId: r._id,
    status: r.status,
    submittedAt: r.submittedAt,
    submissionDisplayId: r.submissionId?.displaySequentialId ?? null,
    submissionSubmittedAt: r.submissionId?.submittedAt ?? null,
  }));

  return { success: true, data: { reviews: sanitized } };
}

/**
 * Fetches the submission content (text / download link) that the
 * student must review.
 */
async function getReviewSubmissionContent({ reviewerId, reviewId }) {
  const safeReviewId = toObjectId(reviewId, 'reviewId');
  const review = await PeerReview.findById(safeReviewId).populate('submissionId');

  if (!review) {
    throw new AppError(404, 'REVIEW_NOT_FOUND', 'Review task not found.');
  }
  if (review.reviewerId.toString() !== reviewerId.toString()) {
    throw new AppError(403, 'FORBIDDEN', 'You are not the assigned reviewer for this task.');
  }

  if (review.status === 'completed') {
    throw new AppError(
      409,
      'REVIEW_ALREADY_SUBMITTED',
      'This review has already been submitted and can no longer be accessed.'
    );
  }

  const submission = review.submissionId;
  let downloadUrl = null;
  if (submission.fileId) {
    downloadUrl = `/api/v1/peer/reviews/${safeReviewId}/submission/download`;
  }

  return {
    success: true,
    data: {
      displaySequentialId: submission.displaySequentialId,
      textContent: submission.textContent,
      downloadUrl,
      hasFile: Boolean(submission.fileId),
    },
  };
}

async function streamReviewSubmissionFile({ reviewerId, reviewId }) {
  const safeReviewId = toObjectId(reviewId, 'reviewId');
  const review = await PeerReview.findById(safeReviewId).populate('submissionId');

  if (!review) {
    throw new AppError(404, 'REVIEW_NOT_FOUND', 'Review task not found.');
  }
  if (review.reviewerId.toString() !== reviewerId.toString()) {
    throw new AppError(403, 'FORBIDDEN', 'You are not the assigned reviewer for this task.');
  }

  // Lock after submission: prevent downloading the file once the review is completed.
  if (review.status === 'completed') {
    throw new AppError(
      409,
      'REVIEW_ALREADY_SUBMITTED',
      'This review has already been submitted and can no longer be accessed.'
    );
  }

  if (!review.submissionId.fileId) {
    throw new AppError(404, 'NO_FILE_ATTACHED', 'No file attached to this submission.');
  }

  return fileStorage.getDownloadStream({ fileId: review.submissionId.fileId });
}

/**
 * Saves the student's review.
 * Prevents resubmission once the review is marked as completed.
 */
async function submitReview({ reviewerId, reviewId, scores, feedbackText, req }) {
  const safeReviewId = toObjectId(reviewId, 'reviewId');
  const review = await PeerReview.findById(safeReviewId);

  if (!review) {
    throw new AppError(404, 'REVIEW_NOT_FOUND', 'Review task not found.');
  }
  if (review.reviewerId.toString() !== reviewerId.toString()) {
    throw new AppError(403, 'FORBIDDEN', 'You are not the assigned reviewer for this task.');
  }

  // Prevent modification after submission — even through a direct API call.
  if (review.status === 'completed') {
    throw new AppError(
      409,
      'REVIEW_ALREADY_SUBMITTED',
      'This review has already been submitted and cannot be modified.'
    );
  }

  const assignment = await PeerAssignment.findById(review.assignmentId).lean();
  if (assignment.reviewDeadline && new Date() > assignment.reviewDeadline) {
    throw new AppError(400, 'REVIEW_DEADLINE_PASSED', 'The review deadline has passed.');
  }

  // "All criteria must be evaluated before submission."
  const requiredCriteria = assignment.rubric.map((r) => r.criterion);
  const providedCriteria = scores.map((s) => s.criterion);
  const missing = requiredCriteria.filter((c) => !providedCriteria.includes(c));
  if (missing.length > 0) {
    throw new AppError(
      400,
      'INCOMPLETE_RUBRIC',
      `All criteria must be evaluated. Missing criteria: ${missing.join(', ')}`
    );
  }

  // Calculate weighted sum according to the rubric defined in the assignment.
  let totalScore = 0;
  for (const criterionDef of assignment.rubric) {
    const provided = scores.find((s) => s.criterion === criterionDef.criterion);
    const normalizedScore = Math.min(Math.max(provided.score, 0), criterionDef.maxScore);
    totalScore += (normalizedScore / criterionDef.maxScore) * criterionDef.weight * 100;
  }

  review.scores = scores;
  review.feedbackText = feedbackText || null;
  review.totalScore = Math.round(totalScore * 100) / 100;
  review.status = 'completed';
  review.submittedAt = new Date();
  await review.save();

  await auditService.record({
    actorId: reviewerId,
    actorRole: 'Student',
    action: 'PEER_REVIEW_SUBMITTED',
    resourceType: 'PeerReview',
    resourceId: review._id.toString(),
    metadata: { assignmentId: review.assignmentId.toString(), totalScore: review.totalScore },
    req,
  });

  // Updates the progress.
  try {
    const progressService = require('../progress.service'); // lazy
    await progressService.checkAndRecordPeerSubmissionCompletion({
      submissionId: review.submissionId,
      req,
    });
  } catch (err) {
    console.error('PEER progress recording failed (non-critical):', err.message);
  }

  return { success: true, data: { review } };
}

async function listReviewsForInstructor({ instructorId, assignmentId }) {
  const safeAssignmentId = toObjectId(assignmentId, 'assignmentId');
  const safeInstructorId = toObjectId(instructorId, 'instructorId');

  // Lazy require to avoid circular dependency.
  const { loadOwnedAssignment } = require('./assignment.service');
  await loadOwnedAssignment(safeAssignmentId, safeInstructorId, {
    unauthorizedAction: 'UNAUTHORIZED_PEER_REVIEW_LIST_ATTEMPT',
  });

  const [submissions, reviews] = await Promise.all([
    PeerSubmission.find({ assignmentId: safeAssignmentId })
      .select(
        'studentId displaySequentialId attemptNumber finalScorePercentage gradeOverridden submittedAt'
      )
      .populate('studentId', 'full_name email')
      .sort({ submittedAt: 1 })
      .lean(),
    PeerReview.find({ assignmentId: safeAssignmentId })
      .populate({ path: 'reviewerId', select: 'full_name email' })
      .sort({ attemptNumber: 1, createdAt: 1 })
      .lean(),
  ]);

  // Index reviews by (submissionId + attemptNumber) to build the tree efficiently O(n)
  const reviewsBySubmission = new Map();
  for (const review of reviews) {
    const key = review.submissionId.toString();
    if (!reviewsBySubmission.has(key)) reviewsBySubmission.set(key, []);
    reviewsBySubmission.get(key).push(review);
  }

  const timeline = submissions.map((submission) => {
    const allReviewsForThisSubmission = reviewsBySubmission.get(submission._id.toString()) || [];

    // Group by attempt number — from 1 to the current attemptNumber of the submission
    const attemptsMap = new Map();
    for (const review of allReviewsForThisSubmission) {
      const n = review.attemptNumber || 1;
      if (!attemptsMap.has(n)) attemptsMap.set(n, []);
      attemptsMap.get(n).push({
        reviewId: review._id,
        reviewer: review.reviewerId
          ? { name: review.reviewerId.full_name, email: review.reviewerId.email }
          : null,
        status: review.status,
        scores: review.scores,
        totalScore: review.totalScore,
        feedbackText: review.feedbackText,
        submittedAt: review.submittedAt,
      });
    }

    const attempts = Array.from(attemptsMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([attemptNumber, attemptReviews]) => {
        const completed = attemptReviews.filter((r) => r.status === 'completed');
        const scores = completed.map((r) => r.totalScore).filter((s) => typeof s === 'number');
        const average =
          scores.length > 0
            ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 100) / 100
            : null;

        return {
          attemptNumber,
          isCurrentAttempt: attemptNumber === (submission.attemptNumber || 1),
          reviews: attemptReviews,
          reviewsCompleted: completed.length,
          reviewsAssigned: attemptReviews.length,
          averageScore: average,
        };
      });

    return {
      submissionId: submission._id,
      student: submission.studentId
        ? { name: submission.studentId.full_name, email: submission.studentId.email }
        : null,
      displaySequentialId: submission.displaySequentialId,
      currentFinalScorePercentage: submission.finalScorePercentage,
      gradeOverridden: submission.gradeOverridden,
      totalAttempts: submission.attemptNumber || 1,
      attempts,
    };
  });

  return { success: true, data: { timeline } };
}

module.exports = {
  listMyReviewTasks,
  getReviewSubmissionContent,
  streamReviewSubmissionFile,
  submitReview,
  listReviewsForInstructor,
};
