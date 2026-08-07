// src/routes/payRoutes.js
const express = require('express');
const router = express.Router();

const payController = require('../controllers/pay.controller');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/requireRole');
const { validateBody } = require('../middleware/validate');
const {
  initiatePaymentSchema,
  requestRefundSchema,
  reviewRefundSchema,
} = require('../validators/paySchemas');

// express.raw() here ONLY — must run before express.json() ever
// touches this path, since Stripe's signature verification (SF-PAY-03)
// requires the untouched raw request body. See app.js wiring.
router.post('/webhook', payController.webhook);

router.post(
  '/initiate',
  requireAuth,
  requireRole(['Student']),
  validateBody(initiatePaymentSchema),
  payController.initiate
);

router.post(
  '/refund-requests',
  requireAuth,
  requireRole(['Student']),
  validateBody(requestRefundSchema),
  payController.requestRefundHandler
);

router.post(
  '/refund-requests/:refundRequestId/review',
  requireAuth,
  requireRole(['Admin', 'SuperAdmin']),
  validateBody(reviewRefundSchema),
  payController.reviewRefundHandler
);

module.exports = router;
