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
  verifyEmailSchema,
  resendVerificationSchema,
  totpVerifySchema,
  mfaLoginVerifySchema,
  googleGuardianEmailSchema,
} = require('../validators/authSchemas');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireCsrfToken } = require('../middleware/csrfProtection');

router.post(
  '/register',
  rateLimit('register', (req) => req.body?.email || 'unknown'),
  validateBody(registerSchema),
  authController.register
);

router.post(
  '/verify-email',
  rateLimit('verify-email', (req) => req.ip),
  validateBody(verifyEmailSchema),
  authController.verifyEmail
);

router.get('/guardian/approve', authController.guardianApprovePagePlaceholder);

router.post(
  '/guardian/approve',
  rateLimit('guardian-approve', (req) => req.ip),
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

router.post(
  '/refresh',
  rateLimit('refresh', (req) => req.ip),
  requireCsrfToken,
  authController.refresh
);

router.post(
  '/forgot-password',
  rateLimit('forgot-password', (req) => req.body?.email || 'unknown'),
  validateBody(forgotPasswordSchema),
  authController.forgotPassword
);

router.post('/reset-password', validateBody(resetPasswordSchema), authController.resetPassword);

router.post(
  '/resend-verification',
  rateLimit('resend-verification', (req) => req.body.email),
  validateBody(resendVerificationSchema),
  authController.resendVerification
);

router.post(
  '/mfa/totp/setup',
  requireAuth,
  rateLimit('mfa-setup', (req) => req.user.id),
  authController.setupTotp
);

router.post(
  '/mfa/totp/verify',
  requireAuth,
  rateLimit('mfa-verify', (req) => req.user.id),
  validateBody(totpVerifySchema),
  authController.verifyTotp
);

router.post(
  '/mfa/login/verify',
  rateLimit('mfa-login-verify', (req) => req.body?.mfaTempToken || 'anonymous'),
  validateBody(mfaLoginVerifySchema),
  authController.verifyMfaLogin
);

const {
  googleLinkConfirmSchema,
  googleRegisterConfirmSchema,
} = require('../validators/authSchemas');

router.get(
  '/google',
  rateLimit('google-consent', (req) => req.ip),
  authController.googleConsent
);

router.get(
  '/google/callback',
  rateLimit('google-callback', (req) => req.ip),
  authController.googleCallback
);

router.post(
  '/google/link/confirm',
  rateLimit('google-link', (req) => req.ip),
  validateBody(googleLinkConfirmSchema),
  authController.googleLinkConfirm
);

router.post(
  '/google/register/confirm',
  rateLimit('google-register', (req) => req.ip),
  validateBody(googleRegisterConfirmSchema),
  authController.googleRegisterConfirm
);

// authRoutes.js
router.post(
  '/google/guardian-email',
  rateLimit('google-guardian-email', (req) => req.ip),
  validateBody(googleGuardianEmailSchema),
  authController.googleGuardianEmail
);

module.exports = router;
