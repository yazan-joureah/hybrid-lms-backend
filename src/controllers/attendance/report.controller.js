// src/controllers/attendance/report.controller.js
// UC-ATT-02 — Export Attendance Reports
const attendanceService = require('../../services/attendanceService');

/** GET /api/v1/attendance/sessions/:sessionId/report */
async function getSessionReport(req, res, next) {
  try {
    const { sessionId } = req.params;
    const result = await attendanceService.getSessionAttendanceReport({
      userId: req.user.id,
      role: req.verifiedRole,
      sessionId,
    });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** GET /api/v1/attendance/sessions/:sessionId/export.csv */
async function exportSessionCSV(req, res, next) {
  try {
    const { sessionId } = req.params;
    const result = await attendanceService.exportSessionAttendanceCSV({
      userId: req.user.id,
      role: req.verifiedRole,
      sessionId,
      req,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.data.filename}"`);
    return res.status(200).send(result.data.csv);
  } catch (err) {
    return next(err);
  }
}

/** GET /api/v1/attendance/courses/:courseId/summary */
async function getCourseSummary(req, res, next) {
  try {
    const { courseId } = req.params;
    const result = await attendanceService.getCourseAttendanceSummary({
      userId: req.user.id,
      role: req.verifiedRole,
      courseId,
    });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getSessionReport, exportSessionCSV, getCourseSummary };
