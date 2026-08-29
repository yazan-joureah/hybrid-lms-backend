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

  let paymentQuery = Payment.findOne(query)
    .select(
      'status amount currency course_id enrollment_id student_id paid_at failure_reason createdAt'
    )
    .populate('course_id', 'title');

  // Admin detail view needs to see who the student is — students polling
  // their own payment already know who they are, so we only pay this
  // extra populate cost when isAdmin is true.
  if (isAdmin) {
    paymentQuery = paymentQuery.populate('student_id', 'full_name email');
  }

  const payment = await paymentQuery.lean();

  if (!payment) {
    throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found.');
  }

  // Admin detail view also needs refund status, same enrichment pattern
  // already used in listMyPayments/listAllPayments (avoid N+1 by scoping
  // this single extra query to the admin path only).
  if (isAdmin) {
    const refundRequest = await RefundRequest.findOne({ payment_id: payment._id })
      .select('status decision_reason')
      .lean();
    payment.refund_request = refundRequest || null;
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

/** GET /pay/admin/payments — admin browsing of all payments on the platform. */
async function listAllPayments({ queryParams = {} }) {
  const page = parseInt(queryParams.page, 10) || 1;
  const limit = parseInt(queryParams.limit, 10) || 20;
  const skip = (page - 1) * limit;

  const query = {};
  if (queryParams.status) query.status = queryParams.status;

  const [payments, totalRecords] = await Promise.all([
    Payment.find(query)
      .populate('student_id', 'full_name email')
      .populate('course_id', 'title')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Payment.countDocuments(query),
  ]);

  const paymentIds = payments.map((p) => p._id);
  const refunds = await RefundRequest.find({ payment_id: { $in: paymentIds } })
    .select('payment_id status decision_reason')
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

module.exports = { getPaymentStatus, listMyPayments, listRefundRequests, listAllPayments };
