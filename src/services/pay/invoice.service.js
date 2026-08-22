// src/services/pay/invoice.service.js
/** UC-PAY-05: generates and emails a simple electronic invoice after successful payment. */
const Invoice = require('../../models/Invoice');
const Course = require('../../models/Course');
const User = require('../../models/User');
const emailService = require('../emailService');
const auditService = require('../auditService');
const { atomicInsertOrFetch } = require('./idempotency.service');

async function generateInvoice({ payment, req }) {
  const invoiceNumber = `INV-${Date.now()}-${payment._id.toString().slice(-6).toUpperCase()}`;

  const { created, record: invoice } = await atomicInsertOrFetch({
    Model: Invoice,
    docData: {
      payment_id: payment._id,
      student_id: payment.student_id,
      course_id: payment.course_id,
      invoice_number: invoiceNumber,
      amount: payment.amount,
      currency: payment.currency,
    },
    findQuery: { payment_id: payment._id },
  });

  if (!created) {
    return { success: true, data: { invoice, alreadyIssued: true } };
  }

  const [student, course] = await Promise.all([
    User.findById(payment.student_id).select('email full_name').lean(),
    Course.findById(payment.course_id).select('title').lean(),
  ]);

  if (student?.email) {
    try {
      await emailService.sendInvoiceEmail(student.email, {
        invoiceNumber,
        courseTitle: course?.title || 'N/A',
        amount: payment.amount,
        currency: payment.currency,
      });
    } catch (err) {
      await auditService.record({
        actorId: null,
        actorRole: 'System',
        action: 'INVOICE_EMAIL_SEND_FAILED',
        resourceType: 'Invoice',
        resourceId: invoice._id.toString(),
        metadata: { error: err.message },
        req,
      });
    }
  }

  await auditService.record({
    actorId: payment.student_id,
    actorRole: 'Student',
    action: 'INVOICE_GENERATED',
    resourceType: 'Invoice',
    resourceId: invoice._id.toString(),
    metadata: { invoice_number: invoiceNumber, amount: payment.amount },
    req,
  });

  return { success: true, data: { invoice, alreadyIssued: false } };
}

module.exports = { generateInvoice };
