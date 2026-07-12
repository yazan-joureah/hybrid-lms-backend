/**
 * Zod validation schemas for AUTH endpoints (FR-31 — server-side validation
 * on every endpoint). Source: REST_API_Contract_v1.2_Groups1-4.docx.
 */
const { z } = require('zod');
const { isMinor } = require('../utils/ageCalculator');

/**
 * NIST SP 800-63-4 compliant password policy: length-based, no forced
 * complexity rules (composition rules are known to push users toward
 * predictable patterns — see NIST SP 800-63B guidance). A blocklist check
 * against common passwords is layered on top (NFR-02) via `isBlocklisted`.
 */
const COMMON_PASSWORD_BLOCKLIST = new Set([
  'password123456',
  '123456789012345',
  'qwertyuiopasdfg',
  'letmeinletmein1',
  'iloveyouiloveyou',
]);

function isBlocklisted(password) {
  return COMMON_PASSWORD_BLOCKLIST.has(password.toLowerCase());
}

const registerSchema = z
  .object({
    full_name: z.string().trim().min(2).max(100),
    email: z.string().trim().toLowerCase().email(),
    password: z
      .string()
      .min(15, 'Password must be at least 15 characters (NIST SP 800-63-4)')
      .refine((pw) => !isBlocklisted(pw), 'Password is too common'),
    birth_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'birth_date must be ISO format YYYY-MM-DD')
      .refine((val) => !Number.isNaN(new Date(val).getTime()), 'birth_date is not a valid date'),
    role: z.enum(['Student', 'Instructor']),
    privacy_consent_version: z.string().min(1),
    guardian_email: z.string().trim().toLowerCase().email().optional(),
  })
  .refine((data) => !data.guardian_email || data.guardian_email !== data.email, {
    message: 'guardian_email must differ from email (MUC-AUTH-09)',
    path: ['guardian_email'],
  })
  .refine((data) => !isMinor(data.birth_date) || !!data.guardian_email, {
    message: 'guardian_email is required for users under 18',
    path: ['guardian_email'],
  });

const guardianApproveSchema = z
  .object({
    token: z.string().min(1),
    decision: z.enum(['approve', 'decline']),
    guardian_full_name: z.string().trim().min(1),
    relationship: z.enum(['parent', 'guardian']),
    consent: z.boolean().optional(),
  })
  .refine((data) => data.decision !== 'approve' || data.consent === true, {
    message: 'consent must be true when decision = approve',
    path: ['consent'],
  });

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  // Deliberately NO length/blocklist policy here — this endpoint verifies
  // an EXISTING credential against a stored hash; password strength rules
  // belong only to registration/reset (NFR-01/02), not to every login
  // attempt.
  password: z.string().min(1, 'password is required'),
});

const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  new_password: z
    .string()
    .min(15, 'Password must be at least 15 characters (NIST SP 800-63-4)')
    .refine((pw) => !isBlocklisted(pw), 'Password is too common'),
});

const totpVerifySchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Code must be exactly 6 digits'),
});

const googleLinkConfirmSchema = z.object({
  link_pending_token: z.string().min(1),
  password: z.string().min(1),
});

const googleRegisterConfirmSchema = z.object({
  registration_pending_token: z.string().min(1),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// authSchemas.js
const googleGuardianEmailSchema = z.object({
  guardian_pending_token: z.string().min(1),
  guardian_email: z.string().trim().toLowerCase().email(),
});
// أضِفها لـ module.exports

module.exports = {
  registerSchema,
  isBlocklisted,
  guardianApproveSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  totpVerifySchema,
  googleLinkConfirmSchema,
  googleRegisterConfirmSchema,
  googleGuardianEmailSchema,
};
