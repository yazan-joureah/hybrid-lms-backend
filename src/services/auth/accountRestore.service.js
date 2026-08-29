const crypto = require('crypto');
const User = require('../../models/User');
const AuthToken = require('../../models/AuthToken');
const { generateNumericOtp, sha256 } = require('../../utils/crypto');
const { assertCanManageTarget } = require('./manageAccounts.service');
const emailService = require('../emailService');
const auditService = require('../auditService');
const logger = require('../../utils/logger');
const { AppError } = require('../../middleware/errorHandler');

const RESTORE_TOKEN_TTL_MS = 15 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const RESTORE_WINDOW_DAYS = 30;

function isWithinRestoreWindow(deletedAt) {
  if (!deletedAt) return false;
  const windowMs = RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - new Date(deletedAt).getTime() <= windowMs;
}

/** POST /auth/account/restore/request */
async function requestAccountRestore({ email, req }) {
  const user = await User.findOne({ email, status: 'deleted' });

  if (!user || !isWithinRestoreWindow(user.deleted_at)) {
    return { error: null };
  }

  await AuthToken.deleteMany({ user_id: user._id, token_type: 'ACCOUNT_RESTORE', used_at: null });

  const { raw: code, hash } = generateNumericOtp();
  await AuthToken.create({
    user_id: user._id,
    token_hash: hash,
    token_type: 'ACCOUNT_RESTORE',
    expires_at: new Date(Date.now() + RESTORE_TOKEN_TTL_MS),
  });

  try {
    await emailService.sendAccountRestoreEmail(user.email, code);
  } catch (err) {
    logger.error('Account restore email failed to send', { userId: user._id, error: err.message });
  }

  await auditService.record({
    actorId: user._id,
    actorRole: user.role,
    action: 'ACCOUNT_RESTORE_REQUESTED',
    resourceType: 'user',
    resourceId: user._id,
    req,
  });

  return { error: null };
}

/** POST /auth/account/restore/confirm  */
async function confirmAccountRestore({ email, code, req }) {
  const user = await User.findOne({ email, status: 'deleted' });
  if (!user || !isWithinRestoreWindow(user.deleted_at)) {
    return { error: 'INVALID_CODE' };
  }

  const codeHash = sha256(code);
  const authToken = await AuthToken.findOne({
    user_id: user._id,
    token_type: 'ACCOUNT_RESTORE',
    used_at: null,
  }).sort({ created_at: -1 });

  if (!authToken) return { error: 'INVALID_CODE' };
  if (authToken.expires_at < new Date()) return { error: 'CODE_EXPIRED' };
  if (authToken.attempt_count >= MAX_OTP_ATTEMPTS) return { error: 'TOO_MANY_ATTEMPTS' };

  const isValid =
    codeHash.length === authToken.token_hash.length &&
    crypto.timingSafeEqual(Buffer.from(codeHash), Buffer.from(authToken.token_hash));

  if (!isValid) {
    authToken.attempt_count += 1;
    if (authToken.attempt_count >= MAX_OTP_ATTEMPTS) authToken.used_at = new Date();
    await authToken.save();
    return { error: authToken.used_at ? 'TOO_MANY_ATTEMPTS' : 'INVALID_CODE' };
  }

  authToken.used_at = new Date();
  await authToken.save();

  user.status = 'active';
  user.deleted_at = null;
  await user.save();

  await auditService.record({
    actorId: user._id,
    actorRole: user.role,
    action: 'ACCOUNT_RESTORED_SELF',
    resourceType: 'user',
    resourceId: user._id,
    req,
  });

  return { error: null };
}

/** PATCH /admin/accounts/:id/deletion  */
async function adminRestoreAccount({ actorId, actorRole, targetUserId, req }) {
  const targetUser = await User.findById(targetUserId).select('status deleted_at role');
  if (!targetUser) {
    throw new AppError(404, 'USER_NOT_FOUND', 'Target account does not exist.');
  }

  assertCanManageTarget({ actorRole, targetRole: targetUser.role });

  if (targetUser.status !== 'deleted') {
    throw new AppError(409, 'NOT_DELETED', 'Account is not currently deleted.');
  }
  if (!isWithinRestoreWindow(targetUser.deleted_at)) {
    throw new AppError(
      410,
      'RESTORE_WINDOW_EXPIRED',
      'The 30-day restore window for this account has passed.'
    );
  }

  targetUser.status = 'active';
  targetUser.deleted_at = null;
  await targetUser.save();

  await auditService.record({
    actorId,
    actorRole,
    action: 'ACCOUNT_RESTORED_BY_ADMIN',
    resourceType: 'user',
    resourceId: targetUser._id,
    metadata: { target_role: targetUser.role },
    req,
  });

  return { error: null, status: 'active' };
}

module.exports = { requestAccountRestore, confirmAccountRestore, adminRestoreAccount };
