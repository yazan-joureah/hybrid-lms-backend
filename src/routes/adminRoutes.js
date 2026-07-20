// src/routes/adminRoutes.js
//
// General admin routes — mounted once at /api/v1/admin. Any future admin
// action (PAY moderation, reports, account management) is added here as
// its own sub-section, not scattered into module-specific route files.

const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/requireRole');
const { validateBody } = require('../middleware/validate');
const adminCourseController = require('../controllers/admin/adminCourse.controller');
const { courseReviewSchema } = require('../validators/courseSchemas');

// --- Course moderation (UC-COURSE-07) ---
router.get(
  '/courses/pending',
  requireAuth,
  requireRole(['Admin', 'SuperAdmin']),
  adminCourseController.getPendingCourses
);

router.post(
  '/courses/:courseId/review',
  requireAuth,
  requireRole(['Admin', 'SuperAdmin']),
  validateBody(courseReviewSchema),
  adminCourseController.reviewCourseHandler
);

module.exports = router;
