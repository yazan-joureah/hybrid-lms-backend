// src/services/peer/allocation.service.js

const PeerAssignment = require('../../models/peerAssignment.model');
const PeerSubmission = require('../../models/peerSubmission.model');
const PeerReview = require('../../models/peerReview.model');
const Course = require('../../models/Course');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');
const auditService = require('../auditService');

// Minimum number of submissions required before distribution can run.
const MIN_SUBMISSIONS_FOR_DISTRIBUTION = 3;

/**
 * Builds a circular cross‑allocation of reviewers for a given number of submissions.
 * Ensures each submission is reviewed by a fixed number of other submitters,
 * without any student reviewing their own submission.
 *
 * @param {number} submissionCount - Total number of submissions in the pool.
 * @param {number} reviewersPerSubmission - Desired number of reviews per submission.
 * @returns {{ allocation: Array<{ submissionIndex: number, reviewerIndices: number[] }>, effectiveReviewers: number }}
 */
function buildCrossAllocation(submissionCount, reviewersPerSubmission) {
  const maxSafeReviewers = Math.floor((submissionCount - 1) / 2);
  const effectiveReviewers = Math.min(reviewersPerSubmission, maxSafeReviewers || 1);

  const allocation = [];
  for (let i = 0; i < submissionCount; i += 1) {
    const reviewerIndices = [];
    for (let offset = 1; offset <= effectiveReviewers; offset += 1) {
      reviewerIndices.push((i + offset) % submissionCount);
    }
    allocation.push({ submissionIndex: i, reviewerIndices });
  }
  return { allocation, effectiveReviewers };
}

/**
 * Shuffles an array using Fisher‑Yates (Durstenfeld) algorithm.
 * @param {Array} array - The array to shuffle (shallow copy).
 * @returns {Array} A new shuffled array.
 */
function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Distributes peer reviews for a given assignment.
 * - Locks the assignment to 'distributing' to prevent concurrent runs.
 * - Validates that the submission deadline has passed (if set) and there are enough submissions.
 * - Builds a circular allocation and creates review documents.
 * - On success, updates assignment status to 'distributed'.
 * - On failure, rolls back to 'open'.
 *
 * @param {Object} params
 * @param {string} params.assignmentId - The peer assignment ID.
 * @param {string|null} params.actorId - ID of the user initiating the action.
 * @param {string} params.actorRole - Role of the actor (e.g., 'System', 'Instructor').
 * @param {Object|null} params.req - Express request object (for audit logging).
 * @returns {Promise<{ success: boolean, data: Object }>}
 */
async function distributeReviews({
  assignmentId,
  actorId = null,
  actorRole = 'System',
  req = null,
}) {
  const safeAssignmentId = toObjectId(assignmentId, 'assignmentId');

  // Atomic claim: only proceed if status is 'open'
  const claimed = await PeerAssignment.findOneAndUpdate(
    { _id: safeAssignmentId, status: 'open' },
    { $set: { status: 'distributing' } }
  );

  if (!claimed) {
    const current = await PeerAssignment.findById(safeAssignmentId);
    if (!current) {
      throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found.');
    }
    return { success: true, data: { assignment: current, alreadyDistributed: true } };
  }

  // Rollback helper in case of any failure during distribution
  const rollbackToOpen = () =>
    PeerAssignment.updateOne(
      { _id: safeAssignmentId, status: 'distributing' },
      { $set: { status: 'open' } }
    ).catch(() => {});

  try {
    // If a submission deadline exists, ensure it has passed
    if (claimed.submissionDeadline && new Date() < claimed.submissionDeadline) {
      await rollbackToOpen();
      throw new AppError(400, 'SUBMISSION_STILL_OPEN', 'Submission deadline has not yet passed.');
    }

    // Fetch all submissions for this assignment
    const submissions = await PeerSubmission.find({ assignmentId: safeAssignmentId });

    // Check if we have enough submissions for a meaningful distribution
    if (submissions.length < MIN_SUBMISSIONS_FOR_DISTRIBUTION) {
      await rollbackToOpen();
      await auditService.record({
        actorId,
        actorRole,
        action: 'PEER_DISTRIBUTION_FAILED_INSUFFICIENT_SUBMISSIONS',
        resourceType: 'PeerAssignment',
        resourceId: safeAssignmentId.toString(),
        metadata: { submissionCount: submissions.length },
        req,
      });
      throw new AppError(
        400,
        'INSUFFICIENT_SUBMISSIONS',
        `Number of submissions (${submissions.length}) is insufficient for cross‑random distribution (minimum ${MIN_SUBMISSIONS_FOR_DISTRIBUTION}).`
      );
    }

    // Shuffle submissions to avoid ordering bias
    const shuffledSubmissions = shuffle(submissions);
    const { allocation, effectiveReviewers } = buildCrossAllocation(
      shuffledSubmissions.length,
      claimed.reviewersPerSubmission
    );

    // Assign displaySequentialId (1‑based) to each submission for UI ordering
    const bulkSubmissionOps = shuffledSubmissions.map((sub, index) => ({
      updateOne: {
        filter: { _id: sub._id },
        update: { $set: { displaySequentialId: index + 1 } },
      },
    }));
    await PeerSubmission.bulkWrite(bulkSubmissionOps);

    // Build review documents based on allocation
    const reviewDocs = [];
    for (const { submissionIndex, reviewerIndices } of allocation) {
      const submission = shuffledSubmissions[submissionIndex];
      for (const reviewerIdx of reviewerIndices) {
        const reviewerSubmission = shuffledSubmissions[reviewerIdx];
        reviewDocs.push({
          assignmentId: safeAssignmentId,
          submissionId: submission._id,
          reviewerId: reviewerSubmission.studentId,
          status: 'assigned',
        });
      }
    }

    // Insert all review documents; ignore duplicate key errors (if any)
    try {
      await PeerReview.insertMany(reviewDocs, { ordered: false });
    } catch (err) {
      if (err.code !== 11000) throw err;
    }

    // Update assignment status to 'distributed'
    const finalAssignment = await PeerAssignment.findById(safeAssignmentId);
    finalAssignment.status = 'distributed';
    finalAssignment.distributedAt = new Date();
    await finalAssignment.save();

    // Audit the successful distribution
    await auditService.record({
      actorId,
      actorRole,
      action: 'PEER_REVIEWS_DISTRIBUTED',
      resourceType: 'PeerAssignment',
      resourceId: safeAssignmentId.toString(),
      metadata: {
        submissionCount: shuffledSubmissions.length,
        reviewersPerSubmission: effectiveReviewers,
        totalReviewsCreated: reviewDocs.length,
      },
      req,
    });

    return {
      success: true,
      data: {
        assignment: finalAssignment,
        submissionCount: shuffledSubmissions.length,
        reviewCount: reviewDocs.length,
      },
    };
  } catch (err) {
    // Rollback to 'open' on any error
    await rollbackToOpen();
    throw err;
  }
}

/**
 * Top‑up allocation for asynchronous (self‑paced) courses.
 * Called when new submissions arrive after the initial distribution.
 *
 * This function:
 * 1. Finds newcomers (submissions without displaySequentialId).
 * 2. Builds a pool of existing submitters who **still have remaining review quota**.
 * 3. Assigns reviewers from the eligible pool to each newcomer.
 * 4. Also assigns review targets (existing submissions) for each newcomer to review.
 * 5. If no eligible reviewers remain, falls back to the full pool (with a warning and audit flag).
 *
 * @param {Object} params
 * @param {string} params.assignmentId - The peer assignment ID.
 * @param {Object|null} params.req - Optional Express request object for audit.
 * @returns {Promise<{ newcomerCount: number, reviewsCreated: number } | null>}
 */
async function topUpAllocation({ assignmentId, req = null }) {
  const safeAssignmentId = toObjectId(assignmentId, 'assignmentId');
  const assignment = await PeerAssignment.findById(safeAssignmentId);
  if (!assignment || assignment.status !== 'distributed') return null;

  const course = await Course.findById(assignment.courseId).select('is_synchronous').lean();
  if (!course || course.is_synchronous) return null;

  // 1. Identify newcomers (submissions without a sequential ID)
  const newcomers = await PeerSubmission.find({
    assignmentId: safeAssignmentId,
    displaySequentialId: null,
  });
  if (newcomers.length === 0) return null;

  // 2. Existing pool (already had sequential ID assigned)
  const existingPool = await PeerSubmission.find({
    assignmentId: safeAssignmentId,
    displaySequentialId: { $ne: null },
  }).select('_id studentId displaySequentialId');

  if (existingPool.length === 0) return null;

  // =============================================================
  // NEW: Filter existing pool to ONLY those who HAVEN'T met their quota
  // =============================================================
  const quota = assignment.reviewersPerSubmission;

  // 3. Aggregate completed review counts for each existing student
  const studentReviewCounts = await PeerReview.aggregate([
    {
      $match: {
        assignmentId: safeAssignmentId,
        status: 'completed',
        reviewerId: { $in: existingPool.map((s) => s.studentId) },
      },
    },
    {
      $group: {
        _id: '$reviewerId',
        count: { $sum: 1 },
      },
    },
  ]);

  const completedCountMap = {};
  for (const item of studentReviewCounts) {
    completedCountMap[item._id.toString()] = item.count;
  }

  // 4. Keep only students who completed < quota reviews (they still have capacity)
  const availableReviewers = existingPool.filter(
    (sub) => (completedCountMap[sub.studentId.toString()] || 0) < quota
  );

  // 5. If no one has remaining quota, fallback to the full pool (but log a warning)
  let poolToUse = availableReviewers;
  let usedFallback = false;
  if (availableReviewers.length === 0) {
    console.warn(
      `No available reviewers with remaining quota for assignment ${assignmentId}. Using full pool as fallback.`
    );
    poolToUse = existingPool;
    usedFallback = true;
  }

  // 6. Assign sequential IDs to newcomers (based on the current max)
  let nextSeq = Math.max(...existingPool.map((s) => s.displaySequentialId)) + 1;
  const seqOps = newcomers.map((sub) => ({
    updateOne: {
      filter: { _id: sub._id },
      update: { $set: { displaySequentialId: nextSeq++ } },
    },
  }));
  await PeerSubmission.bulkWrite(seqOps);

  // 7. Determine how many reviewers each submission should receive
  const totalPoolSize = existingPool.length + newcomers.length;
  const maxSafeReviewers = Math.floor((totalPoolSize - 1) / 2) || 1;
  const effectiveReviewers = Math.min(
    assignment.reviewersPerSubmission,
    maxSafeReviewers,
    poolToUse.length // Use the filtered pool length as a limit
  );

  // 8. Build review documents
  const reviewDocs = [];

  for (const newcomer of newcomers) {
    // (a) Reviews assigned to the newcomer's submission (reviewers = eligible pool)
    const reviewersForNewcomer = shuffle(poolToUse).slice(0, effectiveReviewers);
    for (const reviewer of reviewersForNewcomer) {
      reviewDocs.push({
        assignmentId: safeAssignmentId,
        submissionId: newcomer._id,
        reviewerId: reviewer.studentId,
        status: 'assigned',
      });
    }

    // (b) Reviews the newcomer must perform on existing submissions
    const submissionsForNewcomerToReview = shuffle(existingPool).slice(0, effectiveReviewers);
    for (const target of submissionsForNewcomerToReview) {
      reviewDocs.push({
        assignmentId: safeAssignmentId,
        submissionId: target._id,
        reviewerId: newcomer.studentId,
        status: 'assigned',
      });
    }
  }

  // 9. Insert reviews (ignore duplicate key errors)
  let insertedCount = 0;
  if (reviewDocs.length > 0) {
    try {
      const result = await PeerReview.insertMany(reviewDocs, { ordered: false });
      insertedCount = result.length;
    } catch (err) {
      if (err.code !== 11000) throw err;
      insertedCount = Array.isArray(err.insertedDocs) ? err.insertedDocs.length : 0;
    }
  }

  // 10. Audit the top‑up operation with rich metadata
  await auditService.record({
    actorId: null,
    actorRole: 'System',
    action: 'PEER_TOPUP_ALLOCATION',
    resourceType: 'PeerAssignment',
    resourceId: safeAssignmentId.toString(),
    metadata: {
      newcomerCount: newcomers.length,
      reviewsCreated: insertedCount,
      effectiveReviewers,
      availableReviewersCount: poolToUse.length,
      usedFallback,
    },
    req,
  });

  return { newcomerCount: newcomers.length, reviewsCreated: insertedCount };
}

/**
 * Re‑allocates new reviewers for a submission that has been re‑submitted after grading (retry).
 *
 * This function:
 * 1. Builds a pool of existing submissions (excluding the retry submission itself)
 *    that already have a displaySequentialId.
 * 2. Assigns a new displaySequentialId to the retry submission (one greater than the current max).
 * 3. Shuffles the pool and selects up to reviewersPerSubmission reviewers.
 * 4. Creates new PeerReview documents for the fresh attempt, preserving the old reviews as historical records.
 * 5. Does NOT modify or delete old reviews.
 *
 * @param {Object} params
 * @param {string} params.assignmentId - The peer assignment ID.
 * @param {string} params.submissionId - The ID of the retry submission.
 * @param {Object|null} params.req - Optional Express request object for audit.
 * @returns {Promise<{ reviewersAssigned: number, attemptNumber: number } | null>}
 */
async function reallocateReviewersForRetry({ assignmentId, submissionId, req = null }) {
  const safeAssignmentId = toObjectId(assignmentId, 'assignmentId');
  const assignment = await PeerAssignment.findById(safeAssignmentId).lean();
  if (!assignment) return null;

  const submission = await PeerSubmission.findById(submissionId);
  if (!submission) return null;

  // Pool of all existing submissions except this one that have a displaySequentialId.
  const pool = await PeerSubmission.find({
    assignmentId: safeAssignmentId,
    _id: { $ne: submission._id },
    displaySequentialId: { $ne: null },
  }).select('_id studentId displaySequentialId');

  if (pool.length === 0) {
    // No other students yet – will be retried later via lifecycle.service as a safety net.
    return null;
  }

  // Determine effective number of reviewers (limited by pool size).
  const effectiveReviewers = Math.min(assignment.reviewersPerSubmission, pool.length);
  const reviewers = shuffle(pool).slice(0, effectiveReviewers);

  // Assign a new displaySequentialId (at the end of the current queue)
  const maxSeq = Math.max(...pool.map((s) => s.displaySequentialId));
  submission.displaySequentialId = maxSeq + 1;
  await submission.save();

  // Build review documents for the new attempt.
  const reviewDocs = reviewers.map((reviewer) => ({
    assignmentId: safeAssignmentId,
    submissionId: submission._id,
    reviewerId: reviewer.studentId,
    status: 'assigned',
    attemptNumber: submission.attemptNumber, // Ensure the review is linked to the correct attempt
  }));

  let insertedCount = 0;
  try {
    const result = await PeerReview.insertMany(reviewDocs, { ordered: false });
    insertedCount = result.length;
  } catch (err) {
    if (err.code !== 11000) throw err;
    insertedCount = Array.isArray(err.insertedDocs) ? err.insertedDocs.length : 0;
  }

  // Audit the retry re‑allocation
  await auditService.record({
    actorId: null,
    actorRole: 'System',
    action: 'PEER_RETRY_REALLOCATION',
    resourceType: 'PeerSubmission',
    resourceId: submission._id.toString(),
    metadata: {
      attemptNumber: submission.attemptNumber,
      reviewersAssigned: insertedCount,
    },
    req,
  });

  return { reviewersAssigned: insertedCount, attemptNumber: submission.attemptNumber };
}

module.exports = {
  distributeReviews,
  buildCrossAllocation,
  topUpAllocation,
  reallocateReviewersForRetry, // NEW
  MIN_SUBMISSIONS_FOR_DISTRIBUTION,
};
