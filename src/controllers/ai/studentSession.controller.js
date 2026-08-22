// src/controllers/ai/studentSession.controller.js
const aiService = require('../../services/aiService');

/** POST /api/v1/ai/courses/:courseId/student/session */
async function startStudentSession(req, res, next) {
  try {
    const studentId = req.user.id;
    const { courseId } = req.params;
    const result = await aiService.startStudentSession({ studentId, courseId, req });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

module.exports = { startStudentSession };
