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

/** POST /api/v1/live/sessions/:sessionId/leave */
async function leaveSession(req, res, next) {
  try {
    const { sessionId } = req.params;
    const studentId = req.user.id;

    const result = await liveService.leaveLiveSession({ studentId, sessionId, req });
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

module.exports = { joinSession, leaveSession };
