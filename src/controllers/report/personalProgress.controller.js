// src/controllers/report/personalProgress.controller.js
// UC-REPORT-03 — View Personal Progress Summary
const { getPersonalProgressSummary } = require('../../services/report/personalProgress.service');

/** GET /api/v1/report/me — Student's own progress, extracted from JWT only. */
async function getMyProgressSummary(req, res, next) {
  try {
    // SECURITY: studentId comes EXCLUSIVELY from req.user.id (server-side
    // JWT claim) — no query param or body field is ever consulted here,
    // matching MUC-REPORT-03's IDOR prevention requirement.
    const result = await getPersonalProgressSummary({ studentId: req.user.id });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getMyProgressSummary };
