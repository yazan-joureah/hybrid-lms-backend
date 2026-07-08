/**
 * Password Recovery — Bounded Context.
 * Extracted from the monolithic authService.js (642 lines) during the
 * Refactor phase. Pure structural move — ZERO behavioral change. Every
 * function body below is byte-identical to its previous location.
 *
 * Covers: UC-AUTH-06 (Reset Password) + FR-03b (Session Revocation).
 */
const User = require('../../models/User');
const AuthToken = require('../../models/AuthToken');
const RefreshToken = require('../../models/RefreshToken');
const { hashPassword, generateOpaqueToken, sha256 } = require('../../utils/crypto');
const emailService = require('../emailService');
const auditService = require('../auditService');
const env = require('../../config/env');
const logger = require('../../utils/logger');

const FORGOT_PASSWORD_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 min — REST_API_Contract_v1.2

/**
 * POST /auth/forgot-password — UC-AUTH-06.
 * Always returns the SAME success signal regardless of whether the email
 * exists (User Enumeration prevention).
 */
async function forgotPassword(input, req) {
  const user = await User.findOne({ email: input.email });

  if (!user) {
    return { error: null };
  }

  // SF-AUTH-05 — Invalidate Previous Reset tokens, atomically.
  await AuthToken.deleteMany({ user_id: user._id, token_type: 'PASSWORD_RESET', used_at: null });

  const { raw, hash } = generateOpaqueToken();
  await AuthToken.create({
    user_id: user._id,
    token_hash: hash,
    token_type: 'PASSWORD_RESET',
    expires_at: new Date(Date.now() + FORGOT_PASSWORD_TOKEN_TTL_MS),
  });

  // MUC-AUTH-11 mitigation: built from env.appUrl, never the Host header.
  const resetUrl = `${env.appUrl}/auth/reset-password?token=${raw}`;

  try {
    await emailService.sendPasswordResetEmail(user.email, resetUrl);
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

/**
 * POST /auth/reset-password — UC-AUTH-06 + FR-03b.
 * The token_version increment here is THE mechanism that instantly
 * invalidates every RefreshToken issued before this exact moment.
 */
async function resetPassword({ rawToken, newPassword }, req) {
  const tokenHash = sha256(rawToken);
  const authToken = await AuthToken.findOne({
    token_hash: tokenHash,
    token_type: 'PASSWORD_RESET',
  });

  if (!authToken) {
    return { error: 'TOKEN_INVALID' };
  }
  if (authToken.used_at) {
    return { error: 'TOKEN_ALREADY_USED' };
  }
  if (authToken.expires_at < new Date()) {
    return { error: 'TOKEN_EXPIRED' };
  }

  const user = await User.findById(authToken.user_id);
  if (!user) {
    return { error: 'TOKEN_INVALID' };
  }

  authToken.used_at = new Date();
  await authToken.save();

  user.password_hash = await hashPassword(newPassword);
  user.token_version += 1; // ← FR-03b

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
