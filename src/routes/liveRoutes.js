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
  chatMessageSchema,
  screenShareSchema,
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

// UC-LIVE-02 — Cancel Session
router.post(
  '/sessions/:sessionId/cancel',
  requireRole(['Instructor']),
  validateBody(cancelSessionSchema),
  liveController.cancelSession
);

// UC-LIVE-03 — View Live Schedule (طالب أو محاضر)
router.get('/sessions', requireRole(['Student', 'Instructor']), liveController.listSessions);

/* ─────────────────────── 2) الانضمام والمصادقة ─────────────────────── */

// UC-LIVE-04 — Join Live Session
router.post(
  '/sessions/:sessionId/join',
  requireRole(['Student']),
  rateLimit('live_join', (req) => req.user.id), // يمنع محاولات تخمين/قصف الانضمام
  liveController.joinSession
);

// UC-ATT-01 (دعم) — Leave — يُنهي تتبع الحضور صراحةً
router.post('/sessions/:sessionId/leave', requireRole(['Student']), liveController.leaveSession);

// UC-LIVE-05 — Lobby Control (المحاضر فقط)
router.get('/sessions/:sessionId/lobby', requireRole(['Instructor']), liveController.listLobby);
router.post(
  '/sessions/:sessionId/lobby/admit-all',
  requireRole(['Instructor']),
  liveController.admitAllFromLobby
);
router.post(
  '/sessions/:sessionId/lobby/:studentId/admit',
  requireRole(['Instructor']),
  liveController.admitFromLobby
);
router.post(
  '/sessions/:sessionId/lobby/:studentId/deny',
  requireRole(['Instructor']),
  liveController.denyFromLobby
);

/* ────────────── 3) إدارة الحضور والمشاركة أثناء البث ────────────── */

// UC-LIVE-06 — In-Stream Chat & Q&A (طالب أو محاضر)
router.post(
  '/sessions/:sessionId/chat',
  requireRole(['Student', 'Instructor']),
  validateBody(chatMessageSchema),
  liveController.sendMessage
);
router.get(
  '/sessions/:sessionId/chat',
  requireRole(['Student', 'Instructor']),
  liveController.getMessages
);

// UC-LIVE-07 — Moderation & Controls (المحاضر فقط لأوامر الكتم/الطرد)
router.post(
  '/sessions/:sessionId/moderation/mute/:studentId',
  requireRole(['Instructor']),
  liveController.mute
);
router.post(
  '/sessions/:sessionId/moderation/unmute/:studentId',
  requireRole(['Instructor']),
  liveController.unmute
);
router.post(
  '/sessions/:sessionId/moderation/mute-all',
  requireRole(['Instructor']),
  liveController.muteAll
);
router.post(
  '/sessions/:sessionId/moderation/remove/:studentId',
  requireRole(['Instructor']),
  liveController.remove
);

// UC-LIVE-07 — Screen Sharing (بدء المحاضر / إيقاف من بدأها)
router.post(
  '/sessions/:sessionId/screen-share',
  requireRole(['Student', 'Instructor']),
  validateBody(screenShareSchema),
  liveController.screenShare
);

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
