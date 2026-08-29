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
const {
  setAccountStatusSchema,
  createAdminAccountSchema,
  deleteAccountSchema,
  reviewDeletionRequestSchema,
} = require('../validators/adminSchemas');
const { rateLimit } = require('../middleware/rateLimiter');

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

// --- Account Management (UC-AUTH-08 + UC-AUTH-14) ---

// Listing/search — Admin or SuperAdmin (read-only, no fine-grained target check needed)
router.get(
  '/accounts',
  requireAuth,
  requireRole(['Admin', 'SuperAdmin']),
  adminController.listAccountsHandler
);

// 08.1 + 08.2 — suspend/activate. Fine-grained target-role check happens
// INSIDE the service (assertCanManageTarget) — route only gates the floor.
router.patch(
  '/accounts/:id/status',
  requireAuth,
  requireRole(['Admin', 'SuperAdmin']),
  validateBody(setAccountStatusSchema),
  adminController.setAccountStatusHandler
);

// 08.3 — create Admin. Coarse gate IS the fine gate here: SuperAdmin-only,
// no target-role ambiguity possible (there is no target yet).
router.post(
  '/accounts',
  requireAuth,
  requireRole(['SuperAdmin']),
  rateLimit('admin-create-account', (req) => req.user.id),
  validateBody(createAdminAccountSchema),
  adminController.createAdminAccountHandler
);

// 08.4 + 08.5 — delete. Same fine-grained pattern as status.
router.delete(
  '/accounts/:id',
  requireAuth,
  requireRole(['Admin', 'SuperAdmin']),
  validateBody(deleteAccountSchema),
  adminController.deleteAccountHandler
);

// Admin-triggered restore — same permission shape as delete (mirrors it).
router.patch(
  '/accounts/:id/deletion',
  requireAuth,
  requireRole(['Admin', 'SuperAdmin']),
  adminController.adminRestoreAccountHandler
);

// SuperAdmin-only review queue — 08.6 approval is explicitly SuperAdmin-only
// in the UC text, so the coarse gate is sufficient here too.
router.get(
  '/deletion-requests',
  requireAuth,
  requireRole(['SuperAdmin']),
  adminController.listDeletionRequestsHandler
);

router.post(
  '/deletion-requests/:id/review',
  requireAuth,
  requireRole(['SuperAdmin']),
  validateBody(reviewDeletionRequestSchema),
  adminController.reviewDeletionRequestHandler
);

module.exports = router;
