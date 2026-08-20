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
const adminController = require('../controllers/adminController');
const { courseReviewSchema, courseStatusSchema } = require('../validators/courseSchemas');
const { kycApproveSchema, kycRejectSchema } = require('../validators/kycSchemas');

// --- Course moderation ---
router.get(
  '/courses/pending',
  requireAuth,
  requireRole(['Admin', 'SuperAdmin']),
  adminController.getPendingCourses
);

router.post(
  '/courses/:courseId/review',
  requireAuth,
  requireRole(['Admin', 'SuperAdmin']),
  validateBody(courseReviewSchema),
  adminController.reviewCourseHandler
);

router.patch(
  '/courses/:courseId/status',
  requireAuth,
  requireRole(['Admin', 'SuperAdmin']),
  validateBody(courseStatusSchema),
  adminController.setCourseStatusHandler
);

router.get(
  '/courses',
  requireAuth,
  requireRole(['Admin', 'SuperAdmin']),
  adminController.getAllCoursesForAdmin
);

// --- KYC moderation ---

router.get(
  '/kyc/requests',
  requireAuth,
  requireRole(['Admin', 'SuperAdmin']),
  adminController.listKycPending
);

router.get(
  '/kyc/requests/:id',
  requireAuth,
  requireRole(['Admin', 'SuperAdmin']),
  adminController.getKycDetail
);

router.get(
  '/kyc/requests/:id/documents/:documentType',
  requireAuth,
  requireRole(['Admin', 'SuperAdmin']),
  adminController.getKycDocumentImage
);

router.post(
  '/kyc/requests/:id/approve',
  requireAuth,
  requireRole(['Admin', 'SuperAdmin']),
  validateBody(kycApproveSchema),
  adminController.approveKyc
);

router.post(
  '/kyc/requests/:id/reject',
  requireAuth,
  requireRole(['Admin', 'SuperAdmin']),
  validateBody(kycRejectSchema),
  adminController.rejectKyc
);

module.exports = router;
