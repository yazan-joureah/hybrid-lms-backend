// src/controllers/live/moderation.controller.js
// UC-LIVE-07 — Moderation & Controls
const liveService = require('../../services/liveService');

async function mute(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { sessionId, studentId } = req.params;
    const result = await liveService.muteParticipant({ instructorId, sessionId, studentId, req });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

async function unmute(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { sessionId, studentId } = req.params;
    const result = await liveService.unmuteParticipant({ instructorId, sessionId, studentId, req });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

async function muteAll(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { sessionId } = req.params;
    const result = await liveService.muteAllParticipants({ instructorId, sessionId, req });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { sessionId, studentId } = req.params;
    const result = await liveService.removeParticipant({ instructorId, sessionId, studentId, req });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

async function screenShare(req, res, next) {
  try {
    const { sessionId } = req.params;
    const { isSharing } = req.validatedBody;
    const result = await liveService.toggleScreenShare({
      userId: req.user.id,
      role: req.verifiedRole,
      sessionId,
      isSharing,
      req,
    });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

module.exports = { mute, unmute, muteAll, remove, screenShare };
