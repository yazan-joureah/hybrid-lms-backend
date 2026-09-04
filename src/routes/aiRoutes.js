/**
 * src/routes/aiRoutes.js
 * وحدة مساعد الذكاء الاصطناعي (AI) — SF-AI-01/02 + UC-AI-01..06
 * يُركَّب في app.js على: /api/v1/ai
 *
 * وحدة مستقلة تماماً، بنفس مبدأ الاستقلالية المطبَّق في PEER/LIVE/ATT.
 * الاعتماديات الوحيدة (قراءة فقط): Course, CourseUnit, CourseProgressEvent,
 * Enrollment, Attendance, User — لا كتابة على أي منها من هذه الوحدة.
 *
 * ملاحظة: لا يوجد Route مباشر لـ SF-AI-01/SF-AI-02 — كلاهما [ISF]
 * تُستدعى فقط داخلياً بـ <<include>> من مسارَي بدء الجلسة أدناه.
 */
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

/* ───────────── جانب المدرّس — UC-AI-04/05/06 (FR-37, FR-42: MFA+KYC) ───────────── */

// UC-AI-04 — Start Instructor AI Session  (include SF-AI-01)
router.post(
  '/courses/:courseId/instructor/session',
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  aiController.startInstructorSession
);

// UC-AI-05 — Generate Content Improvement Suggestions
router.post(
  '/courses/:courseId/instructor/suggestions',
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  rateLimit('ai_instructor_query', (req) => req.user.id),
  validateBody(aiMessageSchema),
  aiController.generateContentSuggestions
);

// UC-AI-06 — View AI Performance Summary
router.post(
  '/courses/:courseId/instructor/performance-summary',
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  rateLimit('ai_instructor_query', (req) => req.user.id),
  validateBody(aiPerformanceSummarySchema),
  aiController.performanceSummary
);

/* ───────────── جانب الطالب — UC-AI-01/02/03 (جلسة صالحة فقط، بلا MFA/KYC) ───────────── */

// UC-AI-01 — Start Student AI Session  (include SF-AI-02)
router.post(
  '/courses/:courseId/student/session',
  requireRole(['Student']),
  aiController.startStudentSession
);

// UC-AI-02 — Query AI Assistant
router.post(
  '/courses/:courseId/student/query',
  requireRole(['Student']),
  rateLimit('ai_student_query', (req) => req.user.id),
  validateBody(aiMessageSchema),
  aiController.queryAssistant
);

// UC-AI-03 — View AI Conversation History (منع MUC-AI-07: studentId من JWT حصراً)
router.get(
  '/courses/:courseId/student/history',
  requireRole(['Student']),
  aiController.listConversationHistory
);

module.exports = router;
