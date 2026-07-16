// src/routes/courseRoutes.js
const express = require('express');
const router = express.Router();

const courseController = require('../controllers/courseController');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/requireRole');
const { rateLimit } = require('../middleware/rateLimiter');
const { validateBody } = require('../middleware/validate');
const { courseCreateSchema, courseUpdateSchema } = require('../validators/courseSchemas'); // Assuming Joi/Zod validator schema

// POST /api/v1/courses - Instructor course creation matching UC-COURSE-05
router.post(
  '/',
  requireAuth,
  requireRole(['Instructor']),
  rateLimit('course-create', (req) => req.user.id),
  validateBody(courseCreateSchema),
  courseController.create
);

// GET /api/v1/courses/instructor/my-courses - Private instructor listing
router.get(
  '/instructor/my-courses',
  requireAuth,
  requireRole(['Instructor']),
  courseController.getMyCourses
);

// POST /api/v1/courses - Instructor course creation
router.post(
  '/',
  requireAuth,
  requireRole(['Instructor']),
  validateBody(courseCreateSchema),
  courseController.create
);

// PUT /api/v1/courses/:courseId - Instructor course update
router.put(
  '/:courseId',
  requireAuth,
  requireRole(['Instructor']),
  validateBody(courseUpdateSchema), // Validates types and max lengths
  courseController.update
);
module.exports = router;
