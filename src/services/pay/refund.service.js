// src/services/pay/refund.service.js
/** UC-PAY-09 (student request) + UC-PAY-07 (admin review)**/
const Payment = require('../../models/Payment');
const RefundRequest = require('../../models/RefundRequest');
const stripe = require('../../config/stripe');
const env = require('../../config/env');
const courseService = require('../courseService');
const auditService = require('../auditService');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');
const { buildRefundIdempotencyKey, atomicInsertOrFetch } = require('./idempotency.service');

/** counts business days between two dates. */
function countBusinessDaysBetween(startDate, endDate) {
  let count = 0;
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  while (current < end) {
    current.setDate(current.getDate() + 1);
    const day = current.getDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

/**
 * UC-PAY-09: student submits a refund request.
 */
async function requestRefund({ studentId, paymentId, reason, req }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safePaymentId = toObjectId(paymentId, 'paymentId');

  const payment = await Payment.findOne({ _id: safePaymentId, student_id: safeStudentId });
  if (!payment) {
    throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found.');
  }
  if (payment.status !== 'paid') {
    throw new AppError(
      400,
      'PAYMENT_NOT_REFUNDABLE',
      'Only successfully paid payments can be refunded.'
    );
  }

  const businessDaysElapsed = countBusinessDaysBetween(payment.paid_at, new Date());
  if (businessDaysElapsed > env.payment.refundWindowBusinessDays) {
    throw new AppError(
      400,
      'REFUND_WINDOW_EXPIRED',
      `Refund window of ${env.payment.refundWindowBusinessDays} business days has passed.`
    );
  }

  const idempotencyKey = buildRefundIdempotencyKey({ paymentId: safePaymentId });
  const { created, record: refundRequest } = await atomicInsertOrFetch({
    Model: RefundRequest,
    docData: {
      payment_id: safePaymentId,
      student_id: safeStudentId,
      status: 'review_pending',
      idempotency_key: idempotencyKey,
    },
    findQuery: { idempotency_key: idempotencyKey },
  });

  if (!created) {
    throw new AppError(
      409,
      'REFUND_ALREADY_REQUESTED',
      'A refund request already exists for this payment.'
    );
  }

  await auditService.record({
    actorId: safeStudentId,
    actorRole: 'Student',
    action: 'REFUND_REQUESTED',
    resourceType: 'RefundRequest',
    resourceId: refundRequest._id.toString(),
    metadata: { payment_id: safePaymentId.toString(), reason: reason || null },
    req,
  });

  return { success: true, data: { refundRequest } };
}

/**
 * UC-PAY-07: any Admin/SuperAdmin approves or rejects.
 */
async function reviewRefund({ reviewerId, refundRequestId, decision, decisionReason, req }) {
  const safeReviewerId = toObjectId(reviewerId, 'reviewerId');
  const safeRefundRequestId = toObjectId(refundRequestId, 'refundRequestId');

  const refundRequest = await RefundRequest.findById(safeRefundRequestId);
  if (!refundRequest) {
    throw new AppError(404, 'REFUND_REQUEST_NOT_FOUND', 'Refund request not found.');
  }
  if (refundRequest.status !== 'review_pending') {
    throw new AppError(409, 'ALREADY_REVIEWED', 'This refund request has already been reviewed.');
  }

  if (decision === 'approve') {
    const payment = await Payment.findById(refundRequest.payment_id);
    if (!payment || payment.status !== 'paid') {
      throw new AppError(
        409,
        'PAYMENT_NOT_REFUNDABLE',
        'Underlying payment is not in a refundable state.'
      );
    }

    await stripe.refunds.create({ payment_intent: payment.gateway_payment_intent_id });

    payment.status = 'refunded';
    await payment.save();

    await courseService.cancelEnrollmentForRefund({ enrollmentId: payment.enrollment_id });

    refundRequest.status = 'approved';
  } else if (decision === 'reject') {
    refundRequest.status = 'rejected';
  } else {
    throw new AppError(400, 'INVALID_DECISION', 'decision must be either approve or reject.');
  }

  refundRequest.reviewer_id = safeReviewerId;
  refundRequest.decision_reason = decisionReason || null;
  refundRequest.reviewed_at = new Date();
  await refundRequest.save();

  await auditService.record({
    actorId: safeReviewerId,
    actorRole: 'Admin',
    action: `REFUND_${decision.toUpperCase()}D`,
    resourceType: 'RefundRequest',
    resourceId: safeRefundRequestId.toString(),
    metadata: { decision, reason: decisionReason || null },
    req,
  });

  return { success: true, data: { refundRequest } };
}

module.exports = { requestRefund, reviewRefund };
