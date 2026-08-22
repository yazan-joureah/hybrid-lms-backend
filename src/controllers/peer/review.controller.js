// src/controllers/peer/review.controller.js
// UC-PEER-03 — Submit Peer Review
const peerService = require('../../services/peerService');

/** GET /api/v1/peer/assignments/:assignmentId/my-reviews */
async function listMyReviews(req, res, next) {
  try {
    const reviewerId = req.user.id;
    const { assignmentId } = req.params;
    const result = await peerService.listMyReviewTasks({ reviewerId, assignmentId });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** GET /api/v1/peer/reviews/:reviewId/submission */
async function getSubmissionToReview(req, res, next) {
  try {
    const reviewerId = req.user.id;
    const { reviewId } = req.params;
    const result = await peerService.getReviewSubmissionContent({ reviewerId, reviewId });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** GET /api/v1/peer/reviews/:reviewId/submission/download */
async function downloadSubmissionFile(req, res, next) {
  try {
    const reviewerId = req.user.id;
    const { reviewId } = req.params;
    const { stream, contentType, filename } = await peerService.streamReviewSubmissionFile({
      reviewerId,
      reviewId,
    });

    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    stream.on('error', next);
    return stream.pipe(res);
  } catch (err) {
    return next(err);
  }
}

/** POST /api/v1/peer/reviews/:reviewId */
async function submitReview(req, res, next) {
  try {
    const reviewerId = req.user.id;
    const { reviewId } = req.params;
    const { scores, feedbackText } = req.validatedBody;

    const result = await peerService.submitReview({
      reviewerId,
      reviewId,
      scores,
      feedbackText,
      req,
    });
    return res.status(200).json({ success: true, message: 'Review submitted.', data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** GET /api/v1/peer/assignments/:assignmentId/reviews (Instructor — quality control) */
async function listReviewsForInstructor(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { assignmentId } = req.params;
    const result = await peerService.listReviewsForInstructor({ instructorId, assignmentId });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listMyReviews,
  getSubmissionToReview,
  downloadSubmissionFile,
  submitReview,
  listReviewsForInstructor,
};
