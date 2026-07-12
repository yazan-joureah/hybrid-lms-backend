/**
 * Google OAuth Login — Bounded Context.
 * Source: UC-AUTH-11, UC-AUTH-12 (always taken — see googleOAuthLogin.js),
 * UC-AUTH-13, MUC-AUTH-14/15.
 */
const User = require('../../models/User');
const ExternalIdentity = require('../../models/ExternalIdentity');
const GuardianApproval = require('../../models/GuardianApproval');
const { buildConsentUrl, exchangeCodeForProfile } = require('../../config/googleOAuthLogin');
const { createState, consumeState } = require('../../utils/oauthState');
const {
  signOAuthLinkPendingToken,
  verifyOAuthLinkPendingToken,
  signOAuthRegistrationPendingToken,
  verifyOAuthRegistrationPendingToken,
  signOAuthGuardianPendingToken,
  verifyOAuthGuardianPendingToken,
  signMfaTempToken,
} = require('../../utils/jwt');
const { verifyPassword, generateOpaqueToken } = require('../../utils/crypto');
const { isMinor } = require('../../utils/ageCalculator');
const { createUserSession } = require('./session.service');
const emailService = require('../emailService');
const auditService = require('../auditService');
const env = require('../../config/env');
const logger = require('../../utils/logger');

const GUARDIAN_APPROVAL_TTL_HOURS = 48;

async function getGoogleConsentUrl() {
  const state = await createState();
  return buildConsentUrl(state);
}

async function handleGoogleCallback({ code, state, req }) {
  const stateValid = await consumeState(state);
  if (!stateValid) {
    return { error: 'INVALID_STATE' };
  }

  let profile;
  try {
    profile = await exchangeCodeForProfile(code);
  } catch (err) {
    logger.error('Google code exchange failed', { error: err.message });
    return { error: 'GOOGLE_EXCHANGE_FAILED' };
  }

  if (!profile.emailVerified) {
    return { error: 'GOOGLE_EMAIL_NOT_VERIFIED' };
  }

  const existingIdentity = await ExternalIdentity.findOne({
    provider: 'GOOGLE',
    provider_user_id: profile.providerUserId,
    revoked_at: null,
  });

  if (existingIdentity) {
    return completeLoginForLinkedUser(existingIdentity.user_id, req);
  }

  const localUserWithSameEmail = await User.findOne({ email: profile.email });

  if (localUserWithSameEmail) {
    const linkPendingToken = signOAuthLinkPendingToken({
      email: profile.email,
      providerUserId: profile.providerUserId,
    });

    await auditService.record({
      actorId: localUserWithSameEmail._id,
      actorRole: 'System',
      action: 'OAUTH_LINK_CONFIRMATION_REQUIRED',
      resourceType: 'user',
      resourceId: localUserWithSameEmail._id,
      req,
    });

    return { error: null, requiresLinkConfirmation: true, linkPendingToken };
  }

  const registrationPendingToken = signOAuthRegistrationPendingToken({
    email: profile.email,
    providerUserId: profile.providerUserId,
    fullName: profile.fullName,
  });

  return { error: null, requiresBirthDate: true, registrationPendingToken };
}

async function completeLoginForLinkedUser(userId, req) {
  const user = await User.findById(userId);
  if (!user) {
    return { error: 'TOKEN_INVALID' };
  }
  if (user.status === 'suspended' || user.status === 'deleted') {
    return { error: 'ACCOUNT_SUSPENDED' };
  }
  if (user.status === 'guardian_pending') {
    return { error: 'GUARDIAN_PENDING' };
  }

  if (user.mfa_enabled) {
    const mfaTempToken = signMfaTempToken({ userId: user._id });
    await auditService.record({
      actorId: user._id,
      actorRole: user.role,
      action: 'LOGIN_MFA_CHALLENGE_ISSUED',
      resourceType: 'user',
      resourceId: user._id,
      metadata: { via: 'google_oauth' },
      req,
    });
    return { error: null, mfaRequired: true, mfaTempToken, mfaMethod: 'TOTP' };
  }

  const { accessToken, refreshTokenRaw } = await createUserSession(user, req);

  await auditService.record({
    actorId: user._id,
    actorRole: user.role,
    action: 'LOGIN_SUCCESS_GOOGLE',
    resourceType: 'user',
    resourceId: user._id,
    req,
  });

  return {
    error: null,
    mfaRequired: false,
    accessToken,
    refreshTokenRaw,
    user: { role: user.role, mfaEnabled: user.mfa_enabled, kycStatus: user.kyc_status },
  };
}

async function confirmGoogleLink({ rawToken, password, req }) {
  let decoded;
  try {
    decoded = verifyOAuthLinkPendingToken(rawToken);
  } catch (err) {
    return { error: 'TOKEN_INVALID' };
  }

  const user = await User.findOne({ email: decoded.sub });
  if (!user || !user.password_hash) {
    return { error: 'TOKEN_INVALID' };
  }

  const passwordValid = await verifyPassword(password, user.password_hash);
  if (!passwordValid) {
    return { error: 'INVALID_PASSWORD' };
  }

  try {
    await ExternalIdentity.create({
      user_id: user._id,
      provider: 'GOOGLE',
      provider_user_id: decoded.providerUserId,
    });
  } catch (err) {
    if (err.code === 11000) {
      return { error: 'ALREADY_LINKED_ELSEWHERE' };
    }
    throw err;
  }

  try {
    await emailService.sendGoogleAccountLinkedNotice(user.email);
  } catch (err) {
    logger.error('Google-linked notice failed to send — link still recorded', {
      userId: user._id,
      error: err.message,
    });
  }

  await auditService.record({
    actorId: user._id,
    actorRole: user.role,
    action: 'GOOGLE_ACCOUNT_LINKED',
    resourceType: 'external_identity',
    resourceId: user._id,
    req,
  });

  return completeLoginForLinkedUser(user._id, req);
}

async function confirmGoogleRegistration({ rawToken, birthDate, req }) {
  let decoded;
  try {
    decoded = verifyOAuthRegistrationPendingToken(rawToken);
  } catch (err) {
    return { error: 'TOKEN_INVALID' };
  }

  const alreadyExists = await User.findOne({ email: decoded.sub });
  if (alreadyExists) {
    return { error: 'EMAIL_ALREADY_REGISTERED' };
  }

  const minor = isMinor(birthDate);

  const user = await User.create({
    full_name: decoded.fullName,
    email: decoded.sub,
    password_hash: null,
    birth_date: new Date(birthDate),
    role: 'Student',
    status: minor ? 'guardian_pending' : 'active',
    email_verified_at: new Date(),
    privacy_consent: {
      policy_version: 'v1.0',
      accepted_at: new Date(),
      ip: req.ip,
      user_agent: req.get('user-agent') || 'unknown',
    },
    terms_accepted_at: new Date(),
  });

  await ExternalIdentity.create({
    user_id: user._id,
    provider: 'GOOGLE',
    provider_user_id: decoded.providerUserId,
  });

  await auditService.record({
    actorId: user._id,
    actorRole: 'Student',
    action: 'USER_REGISTERED_GOOGLE',
    resourceType: 'user',
    resourceId: user._id,
    metadata: { is_minor: minor },
    req,
  });

  if (minor) {
    const guardianPendingToken = signOAuthGuardianPendingToken({ userId: user._id });
    return { error: null, requiresGuardianEmail: true, guardianPendingToken };
  }

  return completeLoginForLinkedUser(user._id, req);
}

async function submitGoogleGuardianEmail({ rawToken, guardianEmail, req }) {
  let decoded;
  try {
    decoded = verifyOAuthGuardianPendingToken(rawToken);
  } catch (err) {
    return { error: 'TOKEN_INVALID' };
  }

  const user = await User.findById(decoded.sub);
  if (!user || user.status !== 'guardian_pending') {
    return { error: 'TOKEN_INVALID' };
  }

  const existingPending = await GuardianApproval.findOne({ user_id: user._id, status: 'pending' });
  if (existingPending) {
    return { error: 'ALREADY_PENDING' };
  }

  const { raw: approvalRaw, hash: approvalHash } = generateOpaqueToken();
  const { raw: studentAccessRaw, hash: studentAccessHash } = generateOpaqueToken();

  await GuardianApproval.create({
    user_id: user._id,
    guardian_email: guardianEmail,
    approval_token_hash: approvalHash,
    student_access_token_hash: studentAccessHash,
    status: 'pending',
    expires_at: new Date(Date.now() + GUARDIAN_APPROVAL_TTL_HOURS * 60 * 60 * 1000),
    student_registration_ip: req.ip,
    student_device_fingerprint: req.get('x-device-fingerprint') || null,
  });

  const approveUrl = `${env.appUrl}/auth/guardian/approve?token=${approvalRaw}`;
  const manageUrl = `${env.appUrl}/auth/guardian/manage?token=${studentAccessRaw}`;

  try {
    await Promise.all([
      emailService.sendGuardianApprovalEmail(guardianEmail, approveUrl, user.full_name),
      emailService.sendGuardianWaitingEmail(user.email, manageUrl),
    ]);
  } catch (err) {
    logger.error('Guardian email(s) failed to send (Google flow) — request still recorded', {
      userId: user._id,
      error: err.message,
    });
  }

  await auditService.record({
    actorId: user._id,
    actorRole: 'System',
    action: 'GUARDIAN_APPROVAL_REQUESTED_GOOGLE',
    resourceType: 'guardian_approval',
    resourceId: user._id,
    req,
  });

  return { error: null };
}

module.exports = {
  getGoogleConsentUrl,
  handleGoogleCallback,
  confirmGoogleLink,
  confirmGoogleRegistration,
  submitGoogleGuardianEmail,
};
