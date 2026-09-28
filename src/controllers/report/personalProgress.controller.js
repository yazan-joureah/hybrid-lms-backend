// src/controllers/report/personalProgress.controller.js
const { getPersonalProgressSummary } = require('../../services/report/personalProgress.service');

/** GET /api/v1/report/me — Student's own progress, extracted from JWT only. */
async function getMyProgressSummary(req, res, next) {
  try {
    const result = await getPersonalProgressSummary({ studentId: req.user.id });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getMyProgressSummary };
