// src/routes/payRoutes.js
const express = require('express');
const router = express.Router();

const payController = require('../controllers/pay.controller');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/requireRole');
const { validateBody } = require('../middleware/validate');
const { rateLimit } = require('../middleware/rateLimiter');
const {
  initiatePaymentSchema,
  requestRefundSchema,
  reviewRefundSchema,
} = require('../validators/paySchemas');

router.post('/webhook', payController.webhook);

router.post(
  '/initiate',
  requireAuth,
  requireRole(['Student']),
  rateLimit('pay-initiate', (req) => req.user.id),
  validateBody(initiatePaymentSchema),
  payController.initiate
);

router.post(
  '/refund-requests',
  requireAuth,
  requireRole(['Student']),
  rateLimit('refund-request', (req) => req.user.id),
  validateBody(requestRefundSchema),
  payController.requestRefundHandler
);

router.post(
  '/refund-requests/:refundRequestId/review',
  requireAuth,
  requireRole(['Admin', 'SuperAdmin']),
  rateLimit('refund-review', (req) => req.user.id),
  validateBody(reviewRefundSchema),
  payController.reviewRefundHandler
);

router.get('/payments/:paymentId', requireAuth, payController.paymentStatus);

router.get('/my-payments', requireAuth, requireRole(['Student']), payController.myPayments);

router.get(
  '/refund-requests',
  requireAuth,
  requireRole(['Admin', 'SuperAdmin']),
  payController.refundRequestsList
);

router.get(
  '/admin/payments',
  requireAuth,
  requireRole(['Admin', 'SuperAdmin']),
  payController.adminListPayments
);

module.exports = router;
