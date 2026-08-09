/**
 * Password Recovery — Bounded Context.
 * Covers: UC-AUTH-06 (Reset Password) + FR-03b (Session Revocation).
 */
const User = require('../../models/User');
const AuthToken = require('../../models/AuthToken');
const RefreshToken = require('../../models/RefreshToken');
const { hashPassword, generateNumericOtp, sha256 } = require('../../utils/crypto'); // CHANGED
const emailService = require('../emailService');
const auditService = require('../auditService');
const logger = require('../../utils/logger');
const crypto = require('crypto');

const FORGOT_PASSWORD_TOKEN_TTL_MS = 15 * 60 * 1000; // unchanged — already 15 min
const MAX_OTP_ATTEMPTS = 5;

/** POST /auth/forgot-password. Same success signal regardless of email existence. */
async function forgotPassword({ email, req }) {
  const user = await User.findOne({ email });
  if (!user) {
    return { error: null };
  }

  await AuthToken.deleteMany({ user_id: user._id, token_type: 'PASSWORD_RESET', used_at: null });

  const { raw: code, hash } = generateNumericOtp();
  await AuthToken.create({
    user_id: user._id,
    token_hash: hash,
    token_type: 'PASSWORD_RESET',
    expires_at: new Date(Date.now() + FORGOT_PASSWORD_TOKEN_TTL_MS),
  });

  try {
    await emailService.sendPasswordResetEmail(user.email, code);
  } catch (err) {
    logger.error('Password reset email failed to send', { userId: user._id, error: err.message });
  }

  await auditService.record({
    actorId: user._id,
    actorRole: user.role,
    action: 'PASSWORD_RESET_REQUESTED',
    resourceType: 'user',
    resourceId: user._id,
    req,
  });

  return { error: null };
}

/** POST /auth/reset-password. token_version increment invalidates every prior RefreshToken (FR-03b). */
async function resetPassword({ email, code, newPassword, req }) {
  // CHANGED signature
  const user = await User.findOne({ email });
  if (!user) {
    return { error: 'INVALID_CODE' };
  }

  const codeHash = sha256(code);
  const authToken = await AuthToken.findOne({
    user_id: user._id,
    token_type: 'PASSWORD_RESET',
    used_at: null,
  }).sort({ created_at: -1 });

  if (!authToken) {
    return { error: 'INVALID_CODE' };
  }
  if (authToken.expires_at < new Date()) {
    return { error: 'CODE_EXPIRED' };
  }
  if (authToken.attempt_count >= MAX_OTP_ATTEMPTS) {
    return { error: 'TOO_MANY_ATTEMPTS' };
  }

  const isValid =
    codeHash.length === authToken.token_hash.length &&
    crypto.timingSafeEqual(Buffer.from(codeHash), Buffer.from(authToken.token_hash));

  if (!isValid) {
    authToken.attempt_count += 1;
    if (authToken.attempt_count >= MAX_OTP_ATTEMPTS) {
      authToken.used_at = new Date();
    }
    await authToken.save();
    return { error: authToken.used_at ? 'TOO_MANY_ATTEMPTS' : 'INVALID_CODE' };
  }

  authToken.used_at = new Date();
  await authToken.save();

  user.password_hash = await hashPassword(newPassword);
  user.token_version += 1;
  user.failed_login_count = 0;
  user.status = user.status === 'temporary_locked' ? 'active' : user.status;
  user.lock_until = null;
  await user.save();

  await RefreshToken.updateMany(
    { user_id: user._id, revoked_at: null },
    { $set: { revoked_at: new Date() } }
  );

  await auditService.record({
    actorId: user._id,
    actorRole: user.role,
    action: 'PASSWORD_RESET_COMPLETED',
    resourceType: 'user',
    resourceId: user._id,
    metadata: { new_token_version: user.token_version },
    req,
  });

  return { error: null };
}

module.exports = { forgotPassword, resetPassword };
