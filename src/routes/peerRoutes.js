/**
 * src/routes/peerRoutes.js
 * وحدة التقييم بين الأقران (PEER) — UC-PEER-01..04 (+ مرحلة التسليم)
 * يُركَّب في app.js على: /api/v1/peer
 *
 * وحدة مستقلة تماماً عن LIVE/ATT/COURSE — نفس مبدأ الاستقلالية المطبَّق
 * سابقاً بين LIVE وATT. الاعتماديات الوحيدة (قراءة فقط): Course (فحص
 * الملكية) وEnrollment (فحص التسجيل)، بنفس نمط joinAccess.service.js.
 */
const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/requireRole');
const requireVerifiedIdentity = require('../middleware/requireVerifiedIdentity.middleware');
const { validateBody } = require('../middleware/validate');
const { rateLimit } = require('../middleware/rateLimiter');
const { createMemoryUpload } = require('../middleware/upload.util');

const peerController = require('../controllers/peerController');
const {
  createAssignmentSchema,
  submitAssignmentSchema,
  submitReviewSchema,
} = require('../validators/peerSchemas');
const { PEER_SUBMISSION_MAX_FILE_SIZE_BYTES } = require('../services/peer/submission.service');

const router = express.Router();
const uploadSubmissionFile = createMemoryUpload(PEER_SUBMISSION_MAX_FILE_SIZE_BYTES, 1);

router.use(requireAuth);

/* ───────────────────────── 1) إدارة المهام ───────────────────────── */

// UC-PEER-01 — Create Peer Assessment Task
router.post(
  '/assignments',
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  validateBody(createAssignmentSchema),
  peerController.createAssignment
);

// عرض قائمة المهام (محاضر: مهامه، طالب: مهام كورساته)
router.get(
  '/assignments',
  requireRole(['Student', 'Instructor']),
  peerController.listAssignments
);

// تفاصيل مهمة واحدة
router.get(
  '/assignments/:assignmentId',
  requireRole(['Student', 'Instructor']),
  peerController.getAssignment
);

/* ───────────────────────── 2) مرحلة التسليم ───────────────────────── */

// تسليم/إعادة تسليم الحل (نص و/أو ملف) — قبل submissionDeadline فقط
router.post(
  '/assignments/:assignmentId/submit',
  requireRole(['Student']),
  rateLimit('peer_submit', (req) => req.user.id),
  uploadSubmissionFile.single('file'),
  validateBody(submitAssignmentSchema),
  peerController.submitAssignment
);

router.get(
  '/assignments/:assignmentId/my-submission',
  requireRole(['Student']),
  peerController.getMySubmission
);

/* ─────────────── 3) التوزيع (احتياطي يدوي — الأساسي عبر Cron) ─────────────── */

// UC-PEER-02 — يُشغَّل تلقائياً من jobs/peerCron.job.js بعد انتهاء مهلة
// التسليم؛ هذا المسار مخصَّص فقط لتجربة/تسريع التوزيع يدوياً عند الحاجة.
router.post(
  '/assignments/:assignmentId/distribute',
  requireRole(['Instructor', 'Admin', 'SuperAdmin']),
  peerController.distribute
);

/* ───────────────────────── 4) مرحلة المراجعة ───────────────────────── */

// UC-PEER-03 — قائمة مهام المراجعة المسنَدة للطالب
router.get(
  '/assignments/:assignmentId/my-reviews',
  requireRole(['Student']),
  peerController.listMyReviews
);

// محتوى التسليم المطلوب مراجعته (بلا كشف هوية صاحبه)
router.get(
  '/reviews/:reviewId/submission',
  requireRole(['Student']),
  peerController.getSubmissionToReview
);

// تنزيل الملف المرفق بالتسليم (إن وُجد)
router.get(
  '/reviews/:reviewId/submission/download',
  requireRole(['Student']),
  peerController.downloadSubmissionFile
);

// إرسال التقييم (الدرجات + الملاحظات)
router.post(
  '/reviews/:reviewId',
  requireRole(['Student']),
  validateBody(submitReviewSchema),
  peerController.submitReview
);

/* ────────── 5) الدرجات (احتياطي يدوي للاحتساب — الأساسي عبر Cron) ────────── */

// UC-PEER-04 — يُشغَّل تلقائياً من jobs/peerCron.job.js بعد انتهاء مهلة
// المراجعة؛ هذا المسار احتياطي يدوي فقط.
router.post(
  '/assignments/:assignmentId/calculate-grades',
  requireRole(['Instructor', 'Admin', 'SuperAdmin']),
  peerController.calculateGrades
);

// الطالب: درجته النهائية + ملاحظات المراجعين (بلا هوياتهم)
// المحاضر/الإدارة: تفصيل كامل لكل الطلاب
router.get(
  '/assignments/:assignmentId/grades',
  requireRole(['Student', 'Instructor', 'Admin', 'SuperAdmin']),
  peerController.getGrades
);

module.exports = router;
