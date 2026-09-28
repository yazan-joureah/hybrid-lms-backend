const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const { validateBody } = require('../middleware/validate');
const { rateLimit, checkLock } = require('../middleware/rateLimiter');
const {
  loginIdentifier,
  mfaLoginVerifyIdentifier,
  mfaTotpVerifyIdentifier,
} = require('../utils/rateLimitIdentifiers');
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
  requestOwnDeletionSchema,
  restoreRequestSchema,
  restoreConfirmSchema,
  guardianManageResendSchema,
  guardianManageUpdateEmailSchema,
} = require('../validators/authSchemas');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireTrustedOrigin } = require('../middleware/csrfProtection');

router.post(
  '/register',
  rateLimit('register', (req) => req.body?.email || 'unknown'),
  validateBody(registerSchema),
  authController.register
);

router.post('/verify-email', validateBody(verifyEmailSchema), authController.verifyEmail);

router.get('/guardian/approve', authController.guardianApprovePagePlaceholder);

router.post(
  '/guardian/approve',
  rateLimit('guardian-approve', (req) => req.ip),
  validateBody(guardianApproveSchema),
  authController.guardianApprove
);

router.post(
  '/login',
  checkLock('login', loginIdentifier),
  validateBody(loginSchema),
  authController.login
);

router.post('/logout', requireAuth, authController.logout);

router.post('/refresh', requireTrustedOrigin, authController.refresh);

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
  checkLock('mfa-verify', mfaTotpVerifyIdentifier),
  validateBody(totpVerifySchema),
  authController.verifyTotp
);

router.post(
  '/mfa/login/verify',
  checkLock('mfa-login-verify', mfaLoginVerifyIdentifier),
  validateBody(mfaLoginVerifySchema),
  authController.verifyMfaLogin
);

const {
  googleLinkConfirmSchema,
  googleRegisterConfirmSchema,
} = require('../validators/authSchemas');

router.get('/google', authController.googleConsent);

router.get('/google/callback', authController.googleCallback);

router.post(
  '/google/link/confirm',
  validateBody(googleLinkConfirmSchema),
  authController.googleLinkConfirm
);

router.post(
  '/google/register/confirm',
  validateBody(googleRegisterConfirmSchema),
  authController.googleRegisterConfirm
);

router.post(
  '/google/guardian-email',
  validateBody(googleGuardianEmailSchema),
  authController.googleGuardianEmail
);

// self-service deletion request.
router.delete(
  '/account',
  requireAuth,
  rateLimit('account-self-delete', (req) => req.user.id),
  validateBody(requestOwnDeletionSchema),
  authController.requestOwnDeletion
);

router.post(
  '/account/restore/request',
  rateLimit('account-restore-request', (req) => req.body?.email || 'unknown'),
  validateBody(restoreRequestSchema),
  authController.requestRestore
);

router.post(
  '/account/restore/confirm',
  validateBody(restoreConfirmSchema),
  authController.confirmRestore
);

router.get('/guardian/manage', authController.getStatus);

router.post(
  '/guardian/manage/resend',
  rateLimit('guardian-manage-resend', (req) => req.body?.token || req.ip),
  validateBody(guardianManageResendSchema),
  authController.resend
);

router.post(
  '/guardian/manage/update-email',
  rateLimit('guardian-manage-update-email', (req) => req.body?.token || req.ip),
  validateBody(guardianManageUpdateEmailSchema),
  authController.updateEmail
);

module.exports = router;
