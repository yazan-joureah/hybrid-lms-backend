/**
 * src/routes/attendanceRoutes.js
 * وحدة تتبع الحضور (ATT) — UC-ATT-01 (تلقائي، لا مسار مباشر له) + UC-ATT-02
 * يُركَّب في app.js على: /api/v1/attendance
 *
 * ملاحظة: UC-ATT-01 (التسجيل التلقائي) ليس له مسار خاص به هنا — يُستدعى
 * داخلياً من UC-LIVE-04 (Join) وUC-LIVE-04/leave، تماماً كما في التوثيق
 * الأصلي (include من LIVE). هذا الملف يحوي فقط ما يخص التقارير (UC-ATT-02)
 * التي هي حالة استخدام مستقلة بحد ذاتها بفاعل مختلف (المحاضر/الإدارة).
 */
const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/requireRole');

const attendanceController = require('../controllers/attendanceController');

const router = express.Router();

router.use(requireAuth);
router.use(requireRole(['Instructor', 'Admin', 'SuperAdmin']));

// UC-ATT-02 — تقرير حضور جلسة واحدة (JSON)
router.get('/sessions/:sessionId/report', attendanceController.getSessionReport);

// UC-ATT-02 — نفس التقرير بصيغة CSV قابلة للتنزيل
router.get('/sessions/:sessionId/export.csv', attendanceController.exportSessionCSV);

// UC-ATT-02 — ملخص نسبة حضور كل طالب عبر كورس كامل
router.get('/courses/:courseId/summary', attendanceController.getCourseSummary);

module.exports = router;
