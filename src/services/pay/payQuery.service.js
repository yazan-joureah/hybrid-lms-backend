// src/services/pay/payQuery.service.js
/** Read-only queries for the PAY module: status polling, history, admin queue. */
const Payment = require('../../models/Payment');
const RefundRequest = require('../../models/RefundRequest');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');

/** GET /pay/payments/:paymentId — used by the post-checkout success/cancel pages to poll status. */
async function getPaymentStatus({ studentId, paymentId, isAdmin = false }) {
  const safePaymentId = toObjectId(paymentId, 'paymentId');
  const query = { _id: safePaymentId };
  if (!isAdmin) {
    query.student_id = toObjectId(studentId, 'studentId');
  }

  const payment = await Payment.findOne(query)
    .select('status amount currency course_id enrollment_id paid_at failure_reason createdAt')
    .populate('course_id', 'title')
    .lean();

  if (!payment) {
    throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found.');
  }
  return { success: true, data: { payment } };
}

/** GET /pay/my-payments — student's own payment history. */
async function listMyPayments({ studentId, queryParams = {} }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const page = parseInt(queryParams.page, 10) || 1;
  const limit = parseInt(queryParams.limit, 10) || 10;
  const skip = (page - 1) * limit;

  const query = { student_id: safeStudentId };
  if (queryParams.status) query.status = queryParams.status;

  const [payments, totalRecords] = await Promise.all([
    Payment.find(query)
      .populate('course_id', 'title')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Payment.countDocuments(query),
  ]);

  // one extra query instead of N+1 — attach refund status per payment
  const paymentIds = payments.map((p) => p._id);
  const refunds = await RefundRequest.find({ payment_id: { $in: paymentIds } })
    .select('payment_id status reviewed_at')
    .lean();
  const refundByPayment = new Map(refunds.map((r) => [r.payment_id.toString(), r]));

  const enriched = payments.map((p) => ({
    ...p,
    refund_request: refundByPayment.get(p._id.toString()) || null,
  }));

  return {
    success: true,
    data: {
      payments: enriched,
      meta: {
        total_records: totalRecords,
        current_page: page,
        total_pages: Math.ceil(totalRecords / limit),
      },
    },
  };
}

/** GET /pay/refund-requests — admin review queue (defaults to pending only). */
async function listRefundRequests({ queryParams = {} }) {
  const page = parseInt(queryParams.page, 10) || 1;
  const limit = parseInt(queryParams.limit, 10) || 10;
  const skip = (page - 1) * limit;

  const query = { status: queryParams.status || 'review_pending' };

  const [refundRequests, totalRecords] = await Promise.all([
    RefundRequest.find(query)
      .populate('student_id', 'full_name email')
      .populate({
        path: 'payment_id',
        select: 'amount currency paid_at course_id',
        populate: { path: 'course_id', select: 'title' },
      })
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    RefundRequest.countDocuments(query),
  ]);

  return {
    success: true,
    data: {
      refundRequests,
      meta: {
        total_records: totalRecords,
        current_page: page,
        total_pages: Math.ceil(totalRecords / limit),
      },
    },
  };
}

module.exports = { getPaymentStatus, listMyPayments, listRefundRequests };
