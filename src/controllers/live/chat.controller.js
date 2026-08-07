// src/controllers/live/chat.controller.js
// UC-LIVE-06 — In-Stream Chat & Q&A
const liveService = require('../../services/liveService');

/** POST /api/v1/live/sessions/:sessionId/chat */
async function sendMessage(req, res, next) {
  try {
    const { sessionId } = req.params;
    const { messageType, text } = req.validatedBody;

    const result = await liveService.sendChatMessage({
      userId: req.user.id,
      role: req.verifiedRole,
      sessionId,
      messageType,
      text,
      req,
    });
    return res.status(201).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** GET /api/v1/live/sessions/:sessionId/chat */
async function getMessages(req, res, next) {
  try {
    const { sessionId } = req.params;
    const result = await liveService.getChatMessages({
      userId: req.user.id,
      role: req.verifiedRole,
      sessionId,
      queryParams: req.query,
    });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

module.exports = { sendMessage, getMessages };
