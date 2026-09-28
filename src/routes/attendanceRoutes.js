//src/routes/attendanceRoutes.js
const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/requireRole');
const { validateBody } = require('../middleware/validate');

const attendanceController = require('../controllers/attendanceController');
const { correctAttendanceSchema } = require('../validators/attendanceSchemas');

const router = express.Router();

router.use(requireAuth);
router.use(requireRole(['Instructor', 'Admin', 'SuperAdmin']));

router.get('/sessions/:sessionId/report', attendanceController.getSessionReport);

router.get('/sessions/:sessionId/export.csv', attendanceController.exportSessionCSV);

router.get('/courses/:courseId/summary', attendanceController.getCourseSummary);

router.patch(
  '/sessions/:sessionId/students/:studentId/correct',
  requireRole(['Instructor']),
  validateBody(correctAttendanceSchema),
  attendanceController.correctAttendance
);

module.exports = router;
