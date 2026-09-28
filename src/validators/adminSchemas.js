const { z } = require('zod');

const REASON_MAX_LENGTH = 500;

// suspend/activate. `reason` is mandatory per the
const setAccountStatusSchema = z.object({
  action: z.enum(['suspend', 'activate']),
  reason: z.string().trim().min(1, 'reason is required').max(REASON_MAX_LENGTH),
});

// create Admin. No password field: the account is
// provisioned password-less and completes setup via emailed OTP
// (see manageAccounts.service.js design note).
const createAdminAccountSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  fullName: z.string().trim().min(2).max(100),
});

// delete (Admin-initiated, on someone else's account).
const deleteAccountSchema = z.object({
  reason: z.string().trim().min(1, 'reason is required').max(REASON_MAX_LENGTH),
});

// self-service deletion request.
const requestOwnDeletionSchema = z.object({
  reason: z.string().trim().min(1, 'reason is required').max(REASON_MAX_LENGTH),
});

// SuperAdmin review of a pending self-deletion request. decisionReason is
// mandatory only on rejection.
const reviewDeletionRequestSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    decisionReason: z.string().trim().max(REASON_MAX_LENGTH).optional(),
  })
  .refine((data) => data.decision !== 'reject' || !!data.decisionReason, {
    message: 'decisionReason is required when decision = reject',
    path: ['decisionReason'],
  });

// POST /auth/account/restore/request — self-service, step 1.
const restoreRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

// POST /auth/account/restore/confirm — self-service, step 2.
const restoreConfirmSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  code: z.string().regex(/^\d{6}$/, 'Code must be exactly 6 digits'),
});

module.exports = {
  setAccountStatusSchema,
  createAdminAccountSchema,
  deleteAccountSchema,
  requestOwnDeletionSchema,
  reviewDeletionRequestSchema,
  restoreRequestSchema,
  restoreConfirmSchema,
};
