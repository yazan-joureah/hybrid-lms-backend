/**
 * Session & Token Lifecycle — Bounded Context.
 * Extracted from the monolithic authService.js (642 lines) during the
 * Refactor phase. Pure structural move — ZERO behavioral change. Every
 * function body below is byte-identical to its previous location.
 *
 * Covers: UC-AUTH-03 (Login), UC-AUTH-04 (Lock Account), UC-AUTH-07
 * (Session Management: Logout + Refresh + Token Rotation), FR-03b.
 */
const User = require('../../models/User');
const Session = require('../../models/Session');
const RefreshToken = require('../../models/RefreshToken');
const MFAConfiguration = require('../../models/MFAConfiguration');
const LoginAttempt = require('../../models/LoginAttempt');
const { verifyPassword, generateOpaqueToken, sha256 } = require('../../utils/crypto');
const { signAccessToken, signMfaTempToken } = require('../../utils/jwt');
const auditService = require('../auditService');
const env = require('../../config/env');

const MAX_FAILED_LOGIN_ATTEMPTS = 5; // matches UC-AUTH-04 exactly
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — REST_API_Contract_v1.2 §1

/**
 * UC-AUTH-04 — Lock Account after Failures.
 * Auto-unlock (extension [a2]) is handled at read-time in loginUser(),
 * not via a Cron Job — cheaper and always consistent with the instant
 * the user actually tries again.
 */
async function handleFailedLogin(user, req) {
  user.failed_login_count += 1;

  if (user.failed_login_count >= MAX_FAILED_LOGIN_ATTEMPTS) {
    user.status = 'temporary_locked';
    user.lock_until = new Date(Date.now() + env.accountLockout.durationMinutes * 60 * 1000);

    await auditService.record({
      actorId: user._id,
      actorRole: user.role,
      action: 'ACCOUNT_LOCKED',
      resourceType: 'user',
      resourceId: user._id,
      metadata: { failed_attempts: user.failed_login_count },
      req,
    });
  }
  await user.save();
}

function computeRedirectTo(user) {
  if (user.role === 'Student') return '/dashboard';
  if (user.role === 'Instructor') {
    return !user.mfa_enabled || user.kyc_status !== 'verified'
      ? '/instructor/setup'
      : '/instructor/dashboard';
  }
  return '/admin/dashboard'; // Admin / SuperAdmin
}

/**
 * Shared session-issuance logic — extracted so both password-based login
 * (loginUser) and Google OAuth login (oauth.service.js) mint sessions
 * identically, with zero duplicated JWT/Session/RefreshToken code.
 */
async function createUserSession(user, req) {
  const session = await Session.create({
    user_id: user._id,
    device_fingerprint: req.get('x-device-fingerprint') || 'unknown',
    ip_address: req.ip,
    user_agent: req.get('user-agent') || 'unknown',
    mfa_verified: false,
    status: 'active',
    expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });

  const accessToken = signAccessToken({ userId: user._id, sessionId: session._id });
  const { raw: refreshTokenRaw, hash: refreshTokenHash } = generateOpaqueToken();

  await RefreshToken.create({
    user_id: user._id,
    session_id: session._id,
    token_hash: refreshTokenHash,
    token_version: user.token_version,
    expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });

  return { accessToken, refreshTokenRaw, session };
}

/**
 * POST /auth/login — UC-AUTH-03 + SF-AUTH-04.
 */
async function loginUser(input, req) {
  const user = await User.findOne({ email: input.email });

  if (!user || !user.password_hash) {
    await LoginAttempt.create({
      user_id: null,
      email_entered: input.email,
      attempt_type: 'LOGIN',
      success: false,
      ip_address: req.ip,
      user_agent: req.get('user-agent') || 'unknown',
    });
    return { error: 'INVALID_CREDENTIALS' };
  }

  if (user.status === 'temporary_locked' && user.lock_until && user.lock_until <= new Date()) {
    user.status = 'active';
    user.failed_login_count = 0;
    user.lock_until = null;
    await user.save();
  }

  if (user.status === 'temporary_locked') {
    return { error: 'ACCOUNT_LOCKED' };
  }

  const passwordValid = await verifyPassword(input.password, user.password_hash);

  await LoginAttempt.create({
    user_id: user._id,
    email_entered: input.email,
    attempt_type: 'LOGIN',
    success: passwordValid,
    ip_address: req.ip,
    user_agent: req.get('user-agent') || 'unknown',
  });

  if (!passwordValid) {
    await handleFailedLogin(user, req);
    return { error: 'INVALID_CREDENTIALS' };
  }

  if (user.failed_login_count > 0) {
    user.failed_login_count = 0;
    await user.save();
  }

  if (!user.email_verified_at) {
    return { error: 'EMAIL_NOT_VERIFIED' };
  }
  if (user.status === 'guardian_pending') {
    return { error: 'GUARDIAN_PENDING' };
  }
  if (user.status === 'suspended' || user.status === 'deleted') {
    return { error: 'ACCOUNT_SUSPENDED' };
  }

  if (user.mfa_enabled) {
    const mfaConfig = await MFAConfiguration.findOne({ user_id: user._id });
    const mfaTempToken = signMfaTempToken({ userId: user._id });

    await auditService.record({
      actorId: user._id,
      actorRole: user.role,
      action: 'LOGIN_MFA_CHALLENGE_ISSUED',
      resourceType: 'user',
      resourceId: user._id,
      req,
    });

    return {
      error: null,
      mfaRequired: true,
      mfaTempToken,
      mfaMethod: mfaConfig?.method || 'EMAIL',
    };
  }

  const { accessToken, refreshTokenRaw } = await createUserSession(user, req);

  await auditService.record({
    actorId: user._id,
    actorRole: user.role,
    action: 'LOGIN_SUCCESS',
    resourceType: 'user',
    resourceId: user._id,
    req,
  });

  return {
    error: null,
    mfaRequired: false,
    accessToken,
    refreshTokenRaw,
    user: {
      role: user.role,
      mfaEnabled: user.mfa_enabled,
      kycStatus: user.kyc_status,
      redirectTo: computeRedirectTo(user),
    },
  };
}

/**
 * POST /auth/logout — UC-AUTH-07.
 * Operates on sessionId (from the verified Access Token's `sid` claim),
 * not on the raw refresh token cookie — robust even if the cookie is
 * already missing/corrupted client-side. Idempotent by design.
 */
async function logoutUser({ sessionId }, req) {
  const session = await Session.findById(sessionId);

  if (session && session.status === 'active') {
    session.status = 'revoked';
    await session.save();
  }

  await RefreshToken.updateMany(
    { session_id: sessionId, revoked_at: null },
    { $set: { revoked_at: new Date() } }
  );

  await auditService.record({
    actorId: req.user?.id || null,
    actorRole: 'System',
    action: 'LOGOUT',
    resourceType: 'session',
    resourceId: sessionId,
    req,
  });

  return { error: null };
}

/**
 * POST /auth/refresh — UC-AUTH-07.
 * Token Rotation (mandatory): every successful refresh issues a BRAND NEW
 * opaque token and immediately revokes the one just presented.
 */
async function refreshSession({ rawRefreshToken }, req) {
  if (!rawRefreshToken) {
    return { error: 'TOKEN_MISSING' };
  }

  const tokenHash = sha256(rawRefreshToken);
  const existingToken = await RefreshToken.findOne({ token_hash: tokenHash });

  if (!existingToken || existingToken.revoked_at || existingToken.expires_at < new Date()) {
    return { error: 'TOKEN_INVALID' };
  }

  const user = await User.findById(existingToken.user_id);
  if (!user) {
    return { error: 'TOKEN_INVALID' };
  }

  // FR-03b enforcement point.
  if (existingToken.token_version !== user.token_version) {
    return { error: 'SESSION_REVOKED' };
  }

  const session = await Session.findById(existingToken.session_id);
  if (!session || session.status !== 'active') {
    return { error: 'TOKEN_INVALID' };
  }

  existingToken.revoked_at = new Date();
  await existingToken.save();

  const { raw: newRefreshTokenRaw, hash: newRefreshTokenHash } = generateOpaqueToken();

  await RefreshToken.create({
    user_id: user._id,
    session_id: session._id,
    token_hash: newRefreshTokenHash,
    token_version: user.token_version,
    expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });

  session.last_activity_at = new Date();
  await session.save();

  const newAccessToken = signAccessToken({ userId: user._id, sessionId: session._id });

  await auditService.record({
    actorId: user._id,
    actorRole: user.role,
    action: 'TOKEN_REFRESHED',
    resourceType: 'session',
    resourceId: session._id,
    req,
  });

  return { error: null, accessToken: newAccessToken, refreshTokenRaw: newRefreshTokenRaw };
}

module.exports = { loginUser, logoutUser, refreshSession, createUserSession, computeRedirectTo };
