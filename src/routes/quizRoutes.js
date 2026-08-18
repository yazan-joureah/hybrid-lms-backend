// src/routes/quizRoutes.js
const express = require('express');
const router = express.Router();

const quizController = require('../controllers/quizController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/requireRole');
const requireVerifiedIdentity = require('../middleware/requireVerifiedIdentity.middleware');
const { rateLimit } = require('../middleware/rateLimiter');
const { validateBody } = require('../middleware/validate');
const {
  quizCreateSchema,
  quizUpdateSchema,
  submitAnswerSchema,
} = require('../validators/quizSchemas');

// --- Instructor: create/manage ---
router.post(
  '/',
  requireAuth,
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  rateLimit('quiz-create', (req) => req.user.id),
  validateBody(quizCreateSchema),
  quizController.create
);

router.get(
  '/',
  requireAuth,
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  quizController.list
);

router.get(
  '/:quizId',
  requireAuth,
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  quizController.getOne
);

router.put(
  '/:quizId',
  requireAuth,
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  validateBody(quizUpdateSchema),
  quizController.update
);

router.delete(
  '/:quizId',
  requireAuth,
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  quizController.remove
);

router.post(
  '/:quizId/publish',
  requireAuth,
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  quizController.publish
);

// --- Admin: view quizzes/exams while reviewing a course ---
router.get(
  '/admin/course/:courseId',
  requireAuth,
  requireRole(['Admin', 'SuperAdmin']),
  quizController.listForAdminReview
);

// --- Student: browse + take ---
router.get(
  '/course/:courseId/available',
  requireAuth,
  requireRole(['Student']),
  quizController.listAvailable
);

router.post(
  '/:quizId/start',
  requireAuth,
  requireRole(['Student']),
  rateLimit('quiz-start', (req) => req.user.id),
  quizController.start
);

router.post(
  '/attempts/:attemptId/answers',
  requireAuth,
  requireRole(['Student']),
  validateBody(submitAnswerSchema),
  quizController.saveAnswer
);

router.post(
  '/attempts/:attemptId/submit',
  requireAuth,
  requireRole(['Student']),
  quizController.submit
);

router.get('/attempts/:attemptId', requireAuth, requireRole(['Student']), quizController.resume);
router.get(
  '/:quizId/current-attempt',
  requireAuth,
  requireRole(['Student']),
  quizController.getCurrent
);
module.exports = router;
