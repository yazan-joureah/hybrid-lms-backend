// src/controllers/ai/instructorSession.controller.js
const aiService = require('../../services/aiService');

/** POST /api/v1/ai/courses/:courseId/instructor/session */
async function startInstructorSession(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId } = req.params;
    const result = await aiService.startInstructorSession({ instructorId, courseId, req });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

module.exports = { startInstructorSession };
