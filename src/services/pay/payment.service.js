// src/services/pay/payment.service.js
/**
 * UC-PAY-01/UC-PAY-02 (merged): creates a Payment record and a Stripe
 * Checkout Session.
 */
const Payment = require('../../models/Payment');
const stripe = require('../../config/stripe');
const env = require('../../config/env');
const { AppError } = require('../../middleware/errorHandler');
const auditService = require('../auditService');
const { toObjectId } = require('../../utils/objectId.util');
const { checkPaymentEligibility } = require('./eligibility.service');
const { buildPaymentIdempotencyKey, atomicInsertOrFetch } = require('./idempotency.service');

/**
 * PCI DSS SAQ-A note: no card data ever touches our server — the student
 * is redirected directly to Stripe's own hosted Checkout page to enter
 * payment details (Hosted Payment Page), exactly as UC-PAY-02 requires.
 */
async function initiatePayment({ studentId, enrollmentId, req }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeEnrollmentId = toObjectId(enrollmentId, 'enrollmentId');

  const { course, enrollment } = await checkPaymentEligibility({
    studentId: safeStudentId,
    enrollmentId: safeEnrollmentId,
  });

  const idempotencyKey = buildPaymentIdempotencyKey({
    studentId: safeStudentId,
    courseId: enrollment.course_id,
  });
  const { created, record: payment } = await atomicInsertOrFetch({
    Model: Payment,
    docData: {
      student_id: safeStudentId,
      course_id: enrollment.course_id,
      enrollment_id: safeEnrollmentId,
      amount: course.price,
      currency: env.payment.currency,
      status: 'pending',
      idempotency_key: idempotencyKey,
    },
    findQuery: { idempotency_key: idempotencyKey },
  });

  // If this Payment already has a live Stripe session (e.g. a retry within
  // the same 24h window) and hasn't failed, reuse it instead of creating
  // a second Checkout Session pointing at the same Payment record.
  if (!created && payment.status === 'pending' && payment.gateway_session_id) {
    const existingSession = await stripe.checkout.sessions.retrieve(payment.gateway_session_id);
    if (existingSession.status === 'open') {
      return { success: true, data: { checkoutUrl: existingSession.url, paymentId: payment._id } };
    }
  }
  if (!created && payment.status === 'paid') {
    throw new AppError(409, 'ALREADY_PAID', 'This enrollment has already been paid for.');
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: env.payment.currency,
          product_data: { name: course.title },
          unit_amount: Math.round(course.price * 100),
        },
        quantity: 1,
      },
    ],

    metadata: {
      payment_id: payment._id.toString(),
      enrollment_id: safeEnrollmentId.toString(),
    },
    success_url: `${env.frontUrl}/payment/success?payment_id=${payment._id}`,
    cancel_url: `${env.frontUrl}/payment/cancelled?payment_id=${payment._id}`,
  });

  payment.gateway_session_id = session.id;
  await payment.save();

  await auditService.record({
    actorId: safeStudentId,
    actorRole: 'Student',
    action: 'PAYMENT_INITIATED',
    resourceType: 'Payment',
    resourceId: payment._id.toString(),
    metadata: {
      course_id: enrollment.course_id.toString(),
      amount: course.price,
      currency: env.payment.currency,
      reused_existing: !created,
    },
    req,
  });

  return { success: true, data: { checkoutUrl: session.url, paymentId: payment._id } };
}

module.exports = { initiatePayment };
