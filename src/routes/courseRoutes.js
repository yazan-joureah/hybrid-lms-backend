// src/routes/courseRoutes.js
const express = require('express');
const router = express.Router();

const courseController = require('../controllers/courseController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/requireRole');
const { rateLimit } = require('../middleware/rateLimiter');
const { validateBody } = require('../middleware/validate');
const requireVerifiedIdentity = require('../middleware/requireVerifiedIdentity.middleware');
const { createMemoryUpload } = require('../middleware/upload.util');
const {
  courseCreateSchema,
  courseUpdateSchema,
  unitCreateSchema,
  contentCreateSchema,
  progressSchema,
  updateUnitSchema,
  reorderUnitsSchema,
  updateContentSchema,
  reorderContentSchema,
} = require('../validators/courseSchemas');

const COURSE_CONTENT_MAX_BYTES = 50 * 1024 * 1024;
const uploadCourseContent = createMemoryUpload(COURSE_CONTENT_MAX_BYTES, 1);
const uploadImage = createMemoryUpload(5 * 1024 * 1024, 1);

// --- Course creation / core management ---
router.post(
  '/',
  requireAuth,
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  rateLimit('course-create', (req) => req.user.id),
  validateBody(courseCreateSchema),
  courseController.create
);

router.get(
  '/instructor/my-courses',
  requireAuth,
  requireRole(['Instructor']),
  courseController.getMyCourses
);

router.put(
  '/:courseId',
  requireAuth,
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  validateBody(courseUpdateSchema),
  courseController.update
);

router.delete(
  '/:courseId',
  requireAuth,
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  courseController.deleteCourse
);

router.patch(
  '/:courseId/cover-image',
  requireAuth,
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  uploadImage.single('image'),
  courseController.setCover
);

router.get('/:courseId/cover-image', courseController.streamCover);

router.post(
  '/:courseId/submit-review',
  requireAuth,
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  courseController.submitForReview
);
router.post(
  '/:courseId/cancel-review',
  requireAuth,
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  courseController.cancelReview
);

// --- Unit management ---
router.post(
  '/:courseId/units',
  requireAuth,
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  validateBody(unitCreateSchema),
  courseController.createUnit
);

router.get(
  '/:courseId/units/:unitId',
  requireAuth,
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  courseController.getUnitDetails
);

router.put(
  '/:courseId/units/:unitId',
  requireAuth,
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  validateBody(updateUnitSchema),
  courseController.updateUnit
);

router.delete(
  '/:courseId/units/:unitId',
  requireAuth,
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  courseController.deleteUnit
);

router.patch(
  '/:courseId/units/reorder',
  requireAuth,
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  validateBody(reorderUnitsSchema),
  courseController.reorderUnits
);

// --- Content management ---
router.post(
  '/:courseId/units/:unitId/content',
  requireAuth,
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  uploadCourseContent.single('file'),
  validateBody(contentCreateSchema),
  courseController.createContent
);

router.put(
  '/:courseId/units/:unitId/content/:contentId',
  requireAuth,
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  uploadCourseContent.single('file'),
  validateBody(updateContentSchema),
  courseController.updateContent
);

router.delete(
  '/:courseId/units/:unitId/content/:contentId',
  requireAuth,
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  courseController.deleteContent
);

router.patch(
  '/:courseId/units/:unitId/content/reorder',
  requireAuth,
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  validateBody(reorderContentSchema),
  courseController.reorderContent
);

// --- Instructor: roster & manage view ---
router.get(
  '/:courseId/manage',
  requireAuth,
  requireRole(['Instructor']),
  courseController.getManage
);
router.get(
  '/:courseId/students',
  requireAuth,
  requireRole(['Instructor']),
  courseController.getCourseStudents
);

// --- Student: unit access ---
router.get(
  '/:courseId/units/:unitId/student-view',
  requireAuth,
  requireRole(['Student']),
  courseController.getUnitDetailsForStudent
);

// --- Public / Student browsing (no auth) ---
router.get('/', courseController.browse);
router.get('/:courseId', courseController.getDetails);
router.get('/:courseId/enrollment-preview', courseController.getEnrollmentPreview);

// --- Student enrollment ---
router.post('/:courseId/enroll', requireAuth, requireRole(['Student']), courseController.enroll);
router.get(
  '/enrollments/my-courses',
  requireAuth,
  requireRole(['Student']),
  courseController.getMyEnrollments
);

// --- Student progress ---
router.post(
  '/:courseId/progress',
  requireAuth,
  requireRole(['Student']),
  validateBody(progressSchema),
  courseController.record
);
router.get(
  '/:courseId/progress-summary',
  requireAuth,
  requireRole(['Student']),
  courseController.getProgressSummary
);

// --- Student content access ---
// Use the same courseController because it includes studentContentController methods
router.get(
  '/:courseId/content',
  requireAuth,
  requireRole(['Student']),
  courseController.getContent
);
router.get(
  '/:courseId/content/:contentId/file',
  requireAuth,
  requireRole(['Student', 'Instructor', 'Admin']),
  courseController.downloadFile
);

module.exports = router;
