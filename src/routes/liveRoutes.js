/**
 * src/routes/liveRoutes.js
 * وحدة الجلسات المباشرة (LIVE) — UC-LIVE-01 حتى UC-LIVE-08
 * يُركَّب في app.js على: /api/v1/live
 *
 * ملاحظة: وحدة الحضور (ATT) لها مسارات منفصلة تماماً في attendanceRoutes.js
 * (/api/v1/attendance) — حسب فصل الاهتمامات المطلوب.
 */
const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/requireRole');
const requireVerifiedIdentity = require('../middleware/requireVerifiedIdentity.middleware');
const { validateBody } = require('../middleware/validate');
const { rateLimit } = require('../middleware/rateLimiter');

const liveController = require('../controllers/live.controller');
const {
  createSessionSchema,
  updateSessionSchema,
  cancelSessionSchema,
  attachRecordingSchema,
} = require('../validators/liveSchemas');

const router = express.Router();

// كل مسارات هذه الوحدة تتطلب مصادقة JWT أولاً
router.use(requireAuth);

/* ───────────────────────── 1) إدارة وحجز الجلسات ───────────────────────── */

// UC-LIVE-01 — Create/Schedule Session
router.post(
  '/sessions',
  requireRole(['Instructor']),
  requireVerifiedIdentity, // نفس مستوى التحقق المطلوب لإنشاء كورس (SF-AUTH-03)
  validateBody(createSessionSchema),
  liveController.createSession
);

// UC-LIVE-02 — Edit Session
router.put(
  '/sessions/:sessionId',
  requireRole(['Instructor']),
  validateBody(updateSessionSchema),
  liveController.updateSession
);
router.post('/sessions/:sessionId/start', requireRole(['Instructor']), liveController.startSession);

// UC-LIVE-02 — Cancel Session
router.post(
  '/sessions/:sessionId/cancel',
  requireRole(['Instructor']),
  validateBody(cancelSessionSchema),
  liveController.cancelSession
);

// UC-LIVE-03 — View Live Schedule (طالب أو محاضر)
router.get('/sessions', requireRole(['Student', 'Instructor']), liveController.listSessions);

// 1. Get single session
router.get(
  '/sessions/:sessionId',
  requireRole(['Student', 'Instructor']),
  liveController.getSession
);

/* ─────────────────────── 2) الانضمام والمصادقة ─────────────────────── */

// UC-LIVE-04 — Join Live Session
router.post(
  '/sessions/:sessionId/join',
  requireRole(['Student']),
  rateLimit('live_join', (req) => req.user.id), // يمنع محاولات تخمين/قصف الانضمام
  liveController.joinSession
);

// UC-ATT-01 (دعم) — Leave — يُنهي تتبع الحضور صراحةً
router.post(
  '/sessions/:sessionId/leave',
  requireRole(['Student', 'Instructor']),
  liveController.leaveSession
);

/*
 * ملاحظة معمارية: غرفة الانتظار (Lobby)، الدردشة، والإشراف
 * (كتم/طرد/مشاركة الشاشة) لم تعد مسارات LMS مخصّصة — Jitsi
 * الحرة (meet.jit.si) توفّرها فعلياً وبدون تكلفة داخل واجهة
 * الاجتماع نفسها للمحاضر (أول من يدخل الغرفة يصبح Moderator
 * تلقائياً). لا داعي لإعادة بنائها هنا.
 */

/* ─────────────────── 4) ما بعد البث والأرشفة ─────────────────── */

// UC-LIVE-08 — End & Process Recording
router.post('/sessions/:sessionId/end', requireRole(['Instructor']), liveController.endSession);
router.post(
  '/sessions/:sessionId/recording',
  requireRole(['Instructor']),
  validateBody(attachRecordingSchema),
  liveController.attachRecording
);

module.exports = router;
