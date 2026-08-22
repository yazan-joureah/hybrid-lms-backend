// src/routes/peerRoutes.js
/**
 * Peer Assessment Module (PEER) — UC-PEER-01..04 (+ submission phase)
 * Mounted in app.js at: /api/v1/peer
 *
 * Fully independent module (same principle as LIVE/ATT) with read-only dependencies:
 * Course (for ownership checks) and Enrollment (for enrollment checks).
 */
const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/requireRole');
const requireVerifiedIdentity = require('../middleware/requireVerifiedIdentity.middleware');
const { validateBody } = require('../middleware/validate');
const { rateLimit } = require('../middleware/rateLimiter');
const { createMemoryUpload } = require('../middleware/upload.util');

const peerController = require('../controllers/peerController');
const submissionController = require('../controllers/peer/submission.controller');
const {
  createAssignmentSchema,
  submitAssignmentSchema,
  submitReviewSchema,
  updateAssignmentSchema,
  overrideGradeSchema,
} = require('../validators/peerSchemas');
const { PEER_SUBMISSION_POLICY } = require('../config/uploadPolicies');

const router = express.Router();
const uploadSubmissionFile = createMemoryUpload(PEER_SUBMISSION_POLICY.maxFileSizeBytes, 1);

router.use(requireAuth);

/* ───────────────────────── 1) Assignment Management ───────────────────────── */

// UC-PEER-01 — Create Peer Assessment Task
router.post(
  '/assignments',
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  validateBody(createAssignmentSchema),
  peerController.createAssignment
);

// List assignments (Instructor: own; Student: enrolled courses)
router.get('/assignments', requireRole(['Student', 'Instructor']), peerController.listAssignments);

// Single assignment details
router.get(
  '/assignments/:assignmentId',
  requireRole(['Student', 'Instructor']),
  peerController.getAssignment
);

// Update assignment (only before distribution, status='open')
router.patch(
  '/assignments/:assignmentId',
  requireRole(['Instructor']),
  validateBody(updateAssignmentSchema),
  peerController.updateAssignment
);

// Delete assignment (only before distribution and if no submissions exist)
router.delete(
  '/assignments/:assignmentId',
  requireRole(['Instructor']),
  peerController.deleteAssignment
);

/* ───────────────────────── 2) Submission Phase ───────────────────────── */

// Submit / re-submit solution (text and/or file) — only before submissionDeadline
router.post(
  '/assignments/:assignmentId/submit',
  requireRole(['Student']),
  rateLimit('peer_submit', (req) => req.user.id),
  uploadSubmissionFile.single('file'),
  validateBody(submitAssignmentSchema),
  peerController.submitAssignment
);

router.get(
  '/assignments/:assignmentId/my-submission',
  requireRole(['Student']),
  peerController.getMySubmission
);

// Instructor: list submissions to check readiness before distribution
router.get(
  '/assignments/:assignmentId/submissions',
  requireRole(['Instructor']),
  submissionController.listSubmissions
);

/* ─────────────── 3) Distribution (manual fallback — primary via Cron) ─────────────── */

// UC-PEER-02 — automatically triggered by jobs/peerCron.job.js after submission deadline;
// this endpoint is only for manual test / early distribution if needed.
router.post(
  '/assignments/:assignmentId/distribute',
  requireRole(['Instructor', 'Admin', 'SuperAdmin']),
  peerController.distribute
);

/* ───────────────────────── 4) Review Phase ───────────────────────── */

// UC-PEER-03 — List review tasks assigned to the student
router.get(
  '/assignments/:assignmentId/my-reviews',
  requireRole(['Student']),
  peerController.listMyReviews
);

// Submission content to review (without revealing author identity)
router.get(
  '/reviews/:reviewId/submission',
  requireRole(['Student']),
  peerController.getSubmissionToReview
);

// Download attached file from the submission (if any)
router.get(
  '/reviews/:reviewId/submission/download',
  requireRole(['Student']),
  peerController.downloadSubmissionFile
);

// Submit review (scores + feedback)
router.post(
  '/reviews/:reviewId',
  requireRole(['Student']),
  validateBody(submitReviewSchema),
  peerController.submitReview
);

/* ────────── 5) Grades (manual fallback for calculation — primary via Cron) ────────── */

// UC-PEER-04 — automatically triggered by jobs/peerCron.job.js after review deadline;
// this endpoint is only a manual fallback.
router.post(
  '/assignments/:assignmentId/calculate-grades',
  requireRole(['Instructor', 'Admin', 'SuperAdmin']),
  peerController.calculateGrades
);

// Student: final grade + reviewer feedback (without identities)
// Instructor/Admin: full breakdown for all students
router.get(
  '/assignments/:assignmentId/grades',
  requireRole(['Student', 'Instructor', 'Admin', 'SuperAdmin']),
  peerController.getGrades
);

// Instructor: manual override للحالات التي فشل فيها الحساب الآلي (NO_REVIEWER_COMPLETED)
// أو حالات flagged بفارق مراجعين كبير راجعها المدرب يدوياً وقرر الدرجة النهائية.
// متاحة فقط بعد اكتمال الحساب الآلي (assignment.status === 'completed').
router.patch(
  '/assignments/:assignmentId/submissions/:submissionId/override-grade',
  requireRole(['Instructor']),
  rateLimit('peer_grade_override', (req) => req.user.id),
  validateBody(overrideGradeSchema),
  peerController.overrideGrade
);

// Instructor: full review content for quality control (reviewer identity included on purpose)
router.get(
  '/assignments/:assignmentId/reviews',
  requireRole(['Instructor']),
  peerController.listReviewsForInstructor
);

module.exports = router;
