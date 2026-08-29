// src/controllers/pay.controller.js
const {
  initiatePayment,
  requestRefund,
  reviewRefund,
  verifyWebhookSignature,
  processStripeWebhook,
  getPaymentStatus,
  listMyPayments,
  listRefundRequests,
  listAllPayments,
} = require('../services/payService');
const { AppError } = require('../middleware/errorHandler');
const User = require('../models/User');

/** UC-PAY-01/02: student-initiated payment for a pending enrollment. */
async function initiate(req, res, next) {
  try {
    const studentId = req.user.id;
    const { enrollment_id: enrollmentId } = req.body;

    const result = await initiatePayment({ studentId, enrollmentId, req });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** UC-PAY-09: student requests a refund on a paid payment. */
async function requestRefundHandler(req, res, next) {
  try {
    const studentId = req.user.id;
    const { payment_id: paymentId, reason } = req.body;

    const result = await requestRefund({ studentId, paymentId, reason, req });
    return res.status(201).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** UC-PAY-07: admin approves/rejects a refund request. */
async function reviewRefundHandler(req, res, next) {
  try {
    const reviewerId = req.user.id;
    const { refundRequestId } = req.params;
    const { decision, decision_reason: decisionReason } = req.body;

    const result = await reviewRefund({
      reviewerId,
      refundRequestId,
      decision,
      decisionReason,
      req,
    });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

/**
 * UC-PAY-03: Stripe webhook receiver.
 */
async function webhook(req, res, next) {
  try {
    const signatureHeader = req.headers['stripe-signature'];
    if (!signatureHeader) {
      throw new AppError(400, 'MISSING_SIGNATURE', 'Missing Stripe-Signature header.');
    }

    const event = verifyWebhookSignature({ rawBody: req.body, signatureHeader });
    await processStripeWebhook({ event, req });

    // UC-PAY-03: always acknowledge 200 to Stripe
    return res.status(200).json({ received: true });
  } catch (err) {
    return next(err);
  }
}

async function paymentStatus(req, res, next) {
  try {
    // ⚠️ req.user فقط { id, sessionId } — authMiddleware.js عمداً ما بيحط
    // role جوا التوكن (FR-34: role هو server-side truth من الـ DB، مو من
    // التوكن). هاد الراوت مشترك بين الطالب والأدمن (بدون requireRole قبله)
    // فلازم نستعلم عن الدور هون مباشرة، متل ما requireRole.js بالضبط بيعمل.
    const user = await User.findById(req.user.id).select('role').lean();
    const isAdmin = ['Admin', 'SuperAdmin'].includes(user?.role);
    const result = await getPaymentStatus({
      studentId: req.user.id,
      paymentId: req.params.paymentId,
      isAdmin,
    });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

async function myPayments(req, res, next) {
  try {
    const result = await listMyPayments({ studentId: req.user.id, queryParams: req.query });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

async function refundRequestsList(req, res, next) {
  try {
    const result = await listRefundRequests({ queryParams: req.query });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** Admin browsing of all payments on the platform. */
async function adminListPayments(req, res, next) {
  try {
    const result = await listAllPayments({ queryParams: req.query });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  initiate,
  requestRefundHandler,
  reviewRefundHandler,
  webhook,
  paymentStatus,
  myPayments,
  refundRequestsList,
  adminListPayments,
};
