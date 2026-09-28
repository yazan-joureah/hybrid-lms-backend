// src/routes/adminRoutes.js
const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/authMiddleware');
const { requireAdminMfa } = require('../middleware/requireAdminMfa.middleware');
const { requireRole } = require('../middleware/requireRole');
const { validateBody } = require('../middleware/validate');
const adminController = require('../controllers/adminController');
const { courseReviewSchema, courseStatusSchema } = require('../validators/courseSchemas');
const { kycApproveSchema, kycRejectSchema } = require('../validators/kycSchemas');
const {
  setAccountStatusSchema,
  createAdminAccountSchema,
  deleteAccountSchema,
  reviewDeletionRequestSchema,
} = require('../validators/adminSchemas');
const { rateLimit } = require('../middleware/rateLimiter');

router.use(requireAuth, requireAdminMfa);

// --- Course moderation ---
router.get(
  '/courses/pending',
  requireRole(['Admin', 'SuperAdmin']),
  adminController.getPendingCourses
);

router.post(
  '/courses/:courseId/review',
  requireRole(['Admin', 'SuperAdmin']),
  validateBody(courseReviewSchema),
  adminController.reviewCourseHandler
);

router.patch(
  '/courses/:courseId/status',
  requireRole(['Admin', 'SuperAdmin']),
  validateBody(courseStatusSchema),
  adminController.setCourseStatusHandler
);

router.get('/courses', requireRole(['Admin', 'SuperAdmin']), adminController.getAllCoursesForAdmin);

// --- KYC moderation ---
router.get('/kyc/requests', requireRole(['Admin', 'SuperAdmin']), adminController.listKycPending);
router.get('/kyc/requests/:id', requireRole(['Admin', 'SuperAdmin']), adminController.getKycDetail);
router.get(
  '/kyc/requests/:id/documents/:documentType',
  requireRole(['Admin', 'SuperAdmin']),
  adminController.getKycDocumentImage
);
router.post(
  '/kyc/requests/:id/approve',
  requireRole(['Admin', 'SuperAdmin']),
  validateBody(kycApproveSchema),
  adminController.approveKyc
);
router.post(
  '/kyc/requests/:id/reject',
  requireRole(['Admin', 'SuperAdmin']),
  validateBody(kycRejectSchema),
  adminController.rejectKyc
);

// --- Account Management  ---
router.get('/accounts', requireRole(['Admin', 'SuperAdmin']), adminController.listAccountsHandler);

router.patch(
  '/accounts/:id/status',
  requireRole(['Admin', 'SuperAdmin']),
  validateBody(setAccountStatusSchema),
  adminController.setAccountStatusHandler
);

router.post(
  '/accounts',
  requireRole(['SuperAdmin']),
  rateLimit('admin-create-account', (req) => req.user.id),
  validateBody(createAdminAccountSchema),
  adminController.createAdminAccountHandler
);

router.delete(
  '/accounts/:id',
  requireRole(['Admin', 'SuperAdmin']),
  validateBody(deleteAccountSchema),
  adminController.deleteAccountHandler
);

router.patch(
  '/accounts/:id/deletion',
  requireRole(['Admin', 'SuperAdmin']),
  adminController.adminRestoreAccountHandler
);

router.get(
  '/deletion-requests',
  requireRole(['SuperAdmin']),
  adminController.listDeletionRequestsHandler
);

router.post(
  '/deletion-requests/:id/review',
  requireRole(['SuperAdmin']),
  validateBody(reviewDeletionRequestSchema),
  adminController.reviewDeletionRequestHandler
);

// --- Security Audit Statistics ---
router.get('/security-audit/overview', requireRole(['SuperAdmin']), adminController.getOverview);
router.get('/security-audit/events', requireRole(['SuperAdmin']), adminController.listEvents);
router.get('/security-audit/actions', requireRole(['SuperAdmin']), adminController.listActions);

// --- Analytics Dashboard — Admin AND SuperAdmin ---
router.get(
  '/analytics/overview',
  requireRole(['Admin', 'SuperAdmin']),
  adminController.getAnalyticsOverview
);

module.exports = router;
