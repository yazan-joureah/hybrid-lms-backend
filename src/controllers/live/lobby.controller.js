// src/controllers/live/lobby.controller.js
// UC-LIVE-05 — Lobby Control
const liveService = require('../../services/liveService');

/** GET /api/v1/live/sessions/:sessionId/lobby */
async function listLobby(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { sessionId } = req.params;
    const result = await liveService.listLobbyRequests({ instructorId, sessionId, req });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** POST /api/v1/live/sessions/:sessionId/lobby/:studentId/admit */
async function admitFromLobby(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { sessionId, studentId } = req.params;
    const result = await liveService.admitParticipant({ instructorId, sessionId, studentId, req });
    return res
      .status(200)
      .json({ success: true, message: 'Participant admitted.', data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** POST /api/v1/live/sessions/:sessionId/lobby/admit-all */
async function admitAllFromLobby(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { sessionId } = req.params;
    const result = await liveService.admitAllParticipants({ instructorId, sessionId, req });
    return res
      .status(200)
      .json({ success: true, message: 'All participants admitted.', data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** POST /api/v1/live/sessions/:sessionId/lobby/:studentId/deny */
async function denyFromLobby(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { sessionId, studentId } = req.params;
    const result = await liveService.denyParticipant({ instructorId, sessionId, studentId, req });
    return res
      .status(200)
      .json({ success: true, message: 'Participant denied.', data: result.data });
  } catch (err) {
    return next(err);
  }
}

module.exports = { listLobby, admitFromLobby, admitAllFromLobby, denyFromLobby };
