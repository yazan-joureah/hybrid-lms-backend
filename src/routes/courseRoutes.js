// src/routes/courseRoutes.js
const express = require('express');
const router = express.Router();

const courseController = require('../controllers/course/course.controller');
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
} = require('../validators/courseSchemas');

const COURSE_CONTENT_MAX_BYTES = 50 * 1024 * 1024;
const uploadCourseContent = createMemoryUpload(COURSE_CONTENT_MAX_BYTES, 1);

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

router.post(
  '/:courseId/units',
  requireAuth,
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  validateBody(unitCreateSchema),
  courseController.createUnit
);

router.post(
  '/:courseId/units/:unitId/content',
  requireAuth,
  requireRole(['Instructor']),
  requireVerifiedIdentity,
  uploadCourseContent.single('file'),
  validateBody(contentCreateSchema),
  courseController.createContent
);

module.exports = router;
