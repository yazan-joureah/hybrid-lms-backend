const { z } = require('zod');

const initiatePaymentSchema = z.object({
  enrollment_id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId format'),
});

const requestRefundSchema = z.object({
  payment_id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId format'),
  reason: z.string().trim().min(1).optional(),
});

const reviewRefundSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  decision_reason: z.string().trim().min(1).optional(),
});

module.exports = { initiatePaymentSchema, requestRefundSchema, reviewRefundSchema };
