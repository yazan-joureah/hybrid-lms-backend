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

router.use(requireAuth);

router.post(
  '/sessions',
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  rateLimit('live-session-create', (req) => req.user.id),
  validateBody(createSessionSchema),
  liveController.createSession
);

router.put(
  '/sessions/:sessionId',
  requireRole(['Instructor']),
  validateBody(updateSessionSchema),
  liveController.updateSession
);
router.post('/sessions/:sessionId/start', requireRole(['Instructor']), liveController.startSession);

router.post(
  '/sessions/:sessionId/cancel',
  requireRole(['Instructor']),
  validateBody(cancelSessionSchema),
  liveController.cancelSession
);

router.get('/sessions', requireRole(['Student', 'Instructor']), liveController.listSessions);

router.get(
  '/sessions/:sessionId',
  requireRole(['Student', 'Instructor']),
  liveController.getSession
);

router.post(
  '/sessions/:sessionId/join',
  requireRole(['Student']),
  rateLimit('live_join', (req) => req.user.id),
  liveController.joinSession
);

router.post(
  '/sessions/:sessionId/leave',
  requireRole(['Student', 'Instructor']),
  liveController.leaveSession
);

router.post('/sessions/:sessionId/end', requireRole(['Instructor']), liveController.endSession);
router.post(
  '/sessions/:sessionId/recording',
  requireRole(['Instructor']),
  validateBody(attachRecordingSchema),
  liveController.attachRecording
);

module.exports = router;
