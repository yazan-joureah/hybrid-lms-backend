// src/controllers/ai/history.controller.js
const aiService = require('../../services/aiService');

/** GET /api/v1/ai/courses/:courseId/student/history */
async function listConversationHistory(req, res, next) {
  try {
    const studentId = req.user.id; // من JWT حصراً — منع MUC-AI-07 (IDOR)
    const { courseId } = req.params;
    const result = await aiService.listConversationHistory({ studentId, courseId, req });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

module.exports = { listConversationHistory };
