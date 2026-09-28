//src / routes / aiRoutes.js
const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/requireRole');
const requireVerifiedIdentity = require('../middleware/requireVerifiedIdentity.middleware');
const { validateBody } = require('../middleware/validate');
const { rateLimit } = require('../middleware/rateLimiter');

const aiController = require('../controllers/aiController');
const { aiMessageSchema, aiPerformanceSummarySchema } = require('../validators/aiSchemas');

const router = express.Router();

router.use(requireAuth);

// Start Instructor AI Session
router.post(
  '/courses/:courseId/instructor/session',
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  aiController.startInstructorSession
);

// Generate Content Improvement Suggestions
router.post(
  '/courses/:courseId/instructor/suggestions',
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  rateLimit('ai_instructor_query', (req) => req.user.id),
  validateBody(aiMessageSchema),
  aiController.generateContentSuggestions
);

// View AI Performance Summary
router.post(
  '/courses/:courseId/instructor/performance-summary',
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  rateLimit('ai_instructor_query', (req) => req.user.id),
  validateBody(aiPerformanceSummarySchema),
  aiController.performanceSummary
);

// Start Student AI Session
router.post(
  '/courses/:courseId/student/session',
  requireRole(['Student']),
  aiController.startStudentSession
);

// Query AI Assistant
router.post(
  '/courses/:courseId/student/query',
  requireRole(['Student']),
  rateLimit('ai_student_query', (req) => req.user.id),
  validateBody(aiMessageSchema),
  aiController.queryAssistant
);

// View AI Conversation History
router.get(
  '/courses/:courseId/student/history',
  requireRole(['Student']),
  aiController.listConversationHistory
);

module.exports = router;
