/**
 * AUTH routes — Group 1 (Registration & Email Verification).
 * Source: REST_API_Contract_v1.2_Groups1-4.docx.
 */
const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const { validateBody } = require('../middleware/validate');
const { rateLimit } = require('../middleware/rateLimiter');
const {
  registerSchema,
  guardianApproveSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  totpVerifySchema,
} = require('../validators/authSchemas');
const { requireAuth } = require('../middleware/authMiddleware');

router.post(
  '/register',
  rateLimit('register', (req) => req.body?.email || 'unknown'),
  validateBody(registerSchema),
  authController.register
);

router.get('/verify-email', authController.verifyEmail);

router.get('/guardian/approve', authController.guardianApprovePagePlaceholder);

router.post(
  '/guardian/approve',
  validateBody(guardianApproveSchema),
  authController.guardianApprove
);

router.post(
  '/login',
  rateLimit('login', (req) => req.body?.email || 'unknown'),
  validateBody(loginSchema),
  authController.login
);

router.post('/logout', requireAuth, authController.logout);

router.post('/refresh', authController.refresh);

router.post(
  '/forgot-password',
  rateLimit('forgot-password', (req) => req.body?.email || 'unknown'),
  validateBody(forgotPasswordSchema),
  authController.forgotPassword
);

router.post('/reset-password', validateBody(resetPasswordSchema), authController.resetPassword);

router.post('/mfa/totp/setup', requireAuth, authController.setupTotp);

router.post(
  '/mfa/totp/verify',
  requireAuth,
  rateLimit('mfa-verify', (req) => req.user.id),
  validateBody(totpVerifySchema),
  authController.verifyTotp
);

module.exports = router;
