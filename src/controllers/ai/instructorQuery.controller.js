// src/controllers/ai/instructorQuery.controller.js
const aiService = require('../../services/aiService');

/** POST /api/v1/ai/courses/:courseId/instructor/suggestions */
async function generateContentSuggestions(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId } = req.params;
    const { message } = req.validatedBody;
    const result = await aiService.generateContentSuggestions({
      instructorId,
      courseId,
      message,
      req,
    });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** POST /api/v1/ai/courses/:courseId/instructor/performance-summary */
async function performanceSummary(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId } = req.params;
    const { focus } = req.validatedBody || {};
    const result = await aiService.performanceSummary({ instructorId, courseId, focus, req });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

module.exports = { generateContentSuggestions, performanceSummary };
