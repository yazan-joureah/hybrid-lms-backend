// src/services/pay/webhook.service.js
/** UC-PAY-03/04/06: processes a verified Stripe webhook event. */
const Payment = require('../../models/Payment');
const ProcessedWebhookEvent = require('../../models/ProcessedWebhookEvent');
const courseService = require('../courseService');
const auditService = require('../auditService');
const { generateInvoice } = require('./invoice.service');
const { atomicInsertOrFetch } = require('./idempotency.service');

/**
 * entry point for any verified Stripe event (signature already
 * checked by webhookSecurity.service.js in the controller layer).
 * Always resolves successfully so the controller can return 200 to Stripe and avoid
 * needless retry — genuine failures are logged as audit/security
 * events.
 */
async function processStripeWebhook({ event, req }) {
  // duplicate delivery detection — Stripe may
  // redeliver the same event; reusing atomic tool instead of
  // a separate check-then-insert.
  const { created } = await atomicInsertOrFetch({
    Model: ProcessedWebhookEvent,
    docData: { event_id: event.id, event_type: event.type },
    findQuery: { event_id: event.id },
  });
  if (!created) {
    return { success: true, data: { ignored: true, reason: 'DUPLICATE_EVENT' } };
  }

  if (event.type === 'checkout.session.completed') {
    return handleSuccessfulPayment({ session: event.data.object, req });
  }
  if (event.type === 'checkout.session.expired' || event.type === 'payment_intent.payment_failed') {
    return handleFailedPayment({ object: event.data.object, req });
  }

  // Any other Stripe event type we don't act on — acknowledged, not an error.
  return { success: true, data: { ignored: true, reason: 'UNHANDLED_EVENT_TYPE' } };
}

/** activates the enrollment on confirmed payment success. */
async function handleSuccessfulPayment({ session, req }) {
  const paymentId = session.metadata?.payment_id;
  const payment = paymentId ? await Payment.findById(paymentId) : null;

  if (!payment) {
    // no matching operation — log as a security event, do not crash the webhook response
    await auditService.record({
      actorId: null,
      actorRole: 'System',
      action: 'WEBHOOK_PAYMENT_NOT_FOUND',
      resourceType: 'Payment',
      resourceId: paymentId || 'unknown',
      metadata: { stripe_session_id: session.id },
      req,
    });
    return { success: true, data: { ignored: true, reason: 'PAYMENT_NOT_FOUND' } };
  }

  if (payment.status === 'paid') {
    return { success: true, data: { payment, alreadyProcessed: true } };
  }

  payment.status = 'paid';
  payment.paid_at = new Date();
  payment.gateway_payment_intent_id = session.payment_intent || null;
  await payment.save();

  await courseService.activatePendingEnrollment({ enrollmentId: payment.enrollment_id });

  await auditService.record({
    actorId: payment.student_id,
    actorRole: 'Student',
    action: 'PAYMENT_SUCCEEDED',
    resourceType: 'Payment',
    resourceId: payment._id.toString(),
    metadata: { course_id: payment.course_id.toString(), amount: payment.amount },
    req,
  });

  await generateInvoice({ payment, req });
  return { success: true, data: { payment, alreadyProcessed: false } };
}

/** marks a payment as failed. */
async function handleFailedPayment({ object, req }) {
  const paymentId = object.metadata?.payment_id;
  const payment = paymentId ? await Payment.findById(paymentId) : null;

  if (!payment) {
    return { success: true, data: { ignored: true, reason: 'PAYMENT_NOT_FOUND' } };
  }
  if (payment.status !== 'pending') {
    return { success: true, data: { payment, alreadyProcessed: true } };
  }

  payment.status = 'failed';
  payment.failure_reason =
    object.last_payment_error?.message || 'Payment session expired or failed.';
  await payment.save();

  await auditService.record({
    actorId: payment.student_id,
    actorRole: 'Student',
    action: 'PAYMENT_FAILED',
    resourceType: 'Payment',
    resourceId: payment._id.toString(),
    metadata: { reason: payment.failure_reason },
    req,
  });

  return { success: true, data: { payment } };
}

module.exports = { processStripeWebhook };
