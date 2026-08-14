// src/controllers/live/join.controller.js
// UC-LIVE-04 — Join Live Session (+ leave، لدعم UC-ATT-01)
const liveService = require('../../services/liveService');

/** POST /api/v1/live/sessions/:sessionId/join */
async function joinSession(req, res, next) {
  try {
    const { sessionId } = req.params;
    const studentId = req.user.id; // JWT فقط — لا تُستخرج الهوية من req.body إطلاقاً

    const result = await liveService.joinLiveSession({ studentId, sessionId, req });
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/v1/live/sessions/:sessionId/leave
 *
 * Records that the current participant left the live session.
 * This does NOT end the session.
 */
async function leaveSession(req, res, next) {
  try {
    const result = await liveService.leaveLiveSession({
      userId: req.user.id,
      role: req.verifiedRole,
      sessionId: req.params.sessionId,
      req,
    });

    return res.status(200).json({
      success: true,
      message: 'Participant left the session.',
      data: result.data,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { joinSession, leaveSession };
