// src/controllers/live/session.controller.js
// UC-LIVE-01 | UC-LIVE-02 | UC-LIVE-03 | UC-LIVE-08
const liveService = require('../../services/liveService');

/** UC-LIVE-01 — POST /api/v1/live/sessions */
async function createSession(req, res, next) {
  try {
    const instructorId = req.user.id;
    const result = await liveService.createSession({
      instructorId,
      sessionData: req.validatedBody,
      req,
    });
    return res.status(201).json({
      success: true,
      message: 'Live session scheduled successfully.',
      data: result.data,
    });
  } catch (err) {
    return next(err);
  }
}

/** UC-LIVE-02 — PUT /api/v1/live/sessions/:sessionId */
async function updateSession(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { sessionId } = req.params;
    const result = await liveService.updateSession({
      instructorId,
      sessionId,
      updateData: req.validatedBody,
      req,
    });
    return res.status(200).json({ success: true, message: 'Session updated.', data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** UC-LIVE-02 — POST /api/v1/live/sessions/:sessionId/cancel */
async function cancelSession(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { sessionId } = req.params;
    const result = await liveService.cancelSession({
      instructorId,
      sessionId,
      reason: req.validatedBody?.reason,
      req,
    });
    return res
      .status(200)
      .json({ success: true, message: 'Session cancelled.', data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** UC-LIVE-03 — GET /api/v1/live/sessions */
async function listSessions(req, res, next) {
  try {
    const result = await liveService.listSessionsForViewer({
      userId: req.user.id,
      role: req.verifiedRole,
      queryParams: req.query,
    });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}
/** POST /api/v1/live/sessions/:sessionId/start */
async function startSession(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { sessionId } = req.params;
    const result = await liveService.startSession({ instructorId, sessionId, req });
    return res.status(200).json({ success: true, message: 'Session started.', data: result.data });
  } catch (err) {
    return next(err);
  }
}
/** UC-LIVE-08 — POST /api/v1/live/sessions/:sessionId/end */
async function endSession(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { sessionId } = req.params;
    const result = await liveService.endSession({ instructorId, sessionId, req });
    return res.status(200).json({ success: true, message: 'Session ended.', data: result.data });
  } catch (err) {
    return next(err);
  }
}

// GET /live/sessions/:sessionId
async function getSession(req, res, next) {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;
    const role = req.verifiedRole;
    // Delegate to a new service function (implement in session.service.js)
    const result = await liveService.getSessionById({ userId, role, sessionId });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** UC-LIVE-08 — POST /api/v1/live/sessions/:sessionId/recording */
async function attachRecording(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { sessionId } = req.params;
    const { recordingUrl } = req.validatedBody;
    const result = await liveService.attachRecording({
      instructorId,
      sessionId,
      recordingUrl,
      req,
    });
    return res
      .status(200)
      .json({ success: true, message: 'Recording attached.', data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** POST /api/v1/live/sessions/:sessionId/students-access */
async function toggleStudentsAccess(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { sessionId } = req.params;
    const { allowed } = req.validatedBody;
    const result = await liveService.toggleStudentsAccess({
      instructorId,
      sessionId,
      allowed,
      req,
    });
    return res.status(200).json({
      success: true,
      message: allowed ? 'تم فتح الحصة للطلاب.' : 'تم قفل دخول الطلاب.',
      data: result.data,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  createSession,
  updateSession,
  cancelSession,
  listSessions,
  startSession,
  endSession,
  attachRecording,
  getSession,
  toggleStudentsAccess,
};
