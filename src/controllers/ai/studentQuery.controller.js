// src/controllers/ai/studentQuery.controller.js
const aiService = require('../../services/aiService');

/** POST /api/v1/ai/courses/:courseId/student/query */
async function queryAssistant(req, res, next) {
  try {
    const studentId = req.user.id;
    const { courseId } = req.params;
    const { message } = req.validatedBody;
    const result = await aiService.queryAssistant({ studentId, courseId, message, req });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

module.exports = { queryAssistant };
