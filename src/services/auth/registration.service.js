/**
 * Registration & Guardian Approval — Bounded Context.
 * Covers: UC-AUTH-01, UC-AUTH-02, email verification State Machine.
 */
const User = require('../../models/User');
const AuthToken = require('../../models/AuthToken');
const GuardianApproval = require('../../models/GuardianApproval');
const {
  hashPassword,
  generateNumericOtp,
  sha256,
  generateOpaqueToken,
} = require('../../utils/crypto');
const { isMinor } = require('../../utils/ageCalculator');
const emailService = require('../emailService');
const auditService = require('../auditService');
const env = require('../../config/env');
const logger = require('../../utils/logger');

const EMAIL_VERIFICATION_TTL_MINUTES = 15;
const MAX_OTP_ATTEMPTS = 5;
const GUARDIAN_APPROVAL_TTL_HOURS = 48;

async function registerUser({
  full_name: fullName,
  email,
  password,
  birth_date: birthDate,
  role,
  privacy_consent_version: privacyConsentVersion,
  guardian_email: guardianEmail,
  req,
}) {
  const existing = await User.findOne({ email }).lean();
  if (existing) {
    logger.debug('Register attempt for existing email — returning generic success');
    return { alreadyExisted: true, requiresGuardianApproval: false };
  }

  const passwordHash = await hashPassword(password);
  const minor = isMinor(birthDate);

  const user = await User.create({
    full_name: fullName,
    email,
    password_hash: passwordHash,
    birth_date: new Date(birthDate),
    role,
    status: 'pending_email_verification',
    privacy_consent: {
      policy_version: privacyConsentVersion,
      accepted_at: new Date(),
      ip: req.ip,
      user_agent: req.get('user-agent') || 'unknown',
    },
    terms_accepted_at: role === 'Student' ? new Date() : null,
  });

  await auditService.record({
    actorId: user._id,
    actorRole: user.role,
    action: 'USER_REGISTERED',
    resourceType: 'user',
    resourceId: user._id,
    metadata: { role: user.role, is_minor: minor },
    req,
  });

  const { raw: verifyCode, hash: verifyHash } = generateNumericOtp(); // CHANGED
  await AuthToken.create({
    user_id: user._id,
    token_hash: verifyHash,
    token_type: 'EMAIL_VERIFICATION',
    expires_at: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MINUTES * 60 * 1000), // CHANGED
  });
  try {
    await emailService.sendVerificationEmail(user.email, verifyCode); // CHANGED — sends the code, not a URL
  } catch (err) {
    logger.error('Verification email failed to send — registration still succeeds', {
      userId: user._id,
      error: err.message,
    });
  }

  let requiresGuardianApproval = false;

  if (minor) {
    requiresGuardianApproval = true;

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

    const approveUrl = `${env.frontUrl}/auth/guardian/approve?token=${approvalRaw}`;
    const manageUrl = `${env.frontUrl}/auth/guardian/manage?token=${studentAccessRaw}`;

    try {
      await Promise.all([
        emailService.sendGuardianApprovalEmail(guardianEmail, approveUrl, user.full_name),
        emailService.sendGuardianWaitingEmail(user.email, manageUrl),
      ]);
    } catch (err) {
      logger.error('Guardian approval email(s) failed to send — registration still succeeds', {
        userId: user._id,
        error: err.message,
      });
    }

    await auditService.record({
      actorId: user._id,
      actorRole: 'System',
      action: 'GUARDIAN_APPROVAL_REQUESTED',
      resourceType: 'guardian_approval',
      resourceId: user._id,
      req,
    });
  }

  return { alreadyExisted: false, requiresGuardianApproval, userId: user._id };
}

// GET /auth/verify-email.
async function verifyEmail({ email, code, req }) {
  const user = await User.findOne({ email });
  if (!user) {
    return { error: 'INVALID_CODE' };
  }

  const codeHash = sha256(code);
  const authToken = await AuthToken.findOne({
    user_id: user._id,
    token_type: 'EMAIL_VERIFICATION',
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

  const crypto = require('crypto');
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

  user.email_verified_at = new Date();

  const minor = isMinor(user.birth_date);
  let guardianApproved = true;
  if (minor) {
    const approval = await GuardianApproval.findOne({ user_id: user._id }).sort({ created_at: -1 });
    guardianApproved = Boolean(approval?.approved_at);
  }

  user.status = guardianApproved ? 'active' : 'guardian_pending';
  await user.save();

  await auditService.record({
    actorId: user._id,
    actorRole: user.role,
    action: 'EMAIL_VERIFIED',
    resourceType: 'user',
    resourceId: user._id,
    metadata: { resulting_status: user.status },
    req,
  });

  return {
    error: null,
    status: user.status,
    nextStep: user.status === 'active' ? 'login' : 'guardian_pending',
  };
}

// POST /auth/resend-verification.
async function resendVerification({ email, req }) {
  const user = await User.findOne({ email });

  if (!user || user.email_verified_at) {
    return { error: null };
  }

  await AuthToken.deleteMany({
    user_id: user._id,
    token_type: 'EMAIL_VERIFICATION',
    used_at: null,
  });

  const { raw: code, hash } = generateNumericOtp();
  await AuthToken.create({
    user_id: user._id,
    token_hash: hash,
    token_type: 'EMAIL_VERIFICATION',
    expires_at: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MINUTES * 60 * 1000),
  });

  try {
    await emailService.sendVerificationEmail(user.email, code);
  } catch (err) {
    logger.error('Resend verification email failed to send', {
      userId: user._id,
      error: err.message,
    });
  }

  await auditService.record({
    actorId: user._id,
    actorRole: user.role,
    action: 'EMAIL_VERIFICATION_RESENT',
    resourceType: 'user',
    resourceId: user._id,
    req,
  });

  return { error: null };
}

/// POST /auth/guardian/approve.
async function processGuardianApproval({
  rawToken,
  decision,
  guardianFullName,
  relationship,
  req,
}) {
  const tokenHash = sha256(rawToken);
  const approval = await GuardianApproval.findOne({ approval_token_hash: tokenHash });

  if (!approval) {
    return { error: 'TOKEN_INVALID' };
  }
  if (approval.status !== 'pending') {
    return { error: 'TOKEN_ALREADY_USED' };
  }
  if (approval.expires_at < new Date()) {
    return { error: 'TOKEN_EXPIRED' };
  }

  const user = await User.findById(approval.user_id);
  if (!user) {
    return { error: 'TOKEN_INVALID' };
  }

  const guardianIp = req.ip;
  const guardianDeviceFingerprint = req.get('x-device-fingerprint') || null;
  approval.guardian_ip = guardianIp;
  approval.guardian_device_fingerprint = guardianDeviceFingerprint;
  approval.guardian_user_agent = req.get('user-agent') || 'unknown';

  if (decision === 'decline') {
    approval.status = 'rejected';
    approval.rejected_at = new Date();
    await approval.save();

    await auditService.record({
      actorRole: 'System',
      action: 'GUARDIAN_DECLINED',
      resourceType: 'guardian_approval',
      resourceId: approval._id,
      metadata: { guardian_ip: guardianIp },
      req,
    });

    try {
      await emailService.sendGuardianDeclinedNotice(user.email);
    } catch (err) {
      logger.error('Guardian-declined notice failed to send — decline still recorded', {
        userId: user._id,
        error: err.message,
      });
    }

    return { error: null, status: 'guardian_pending', decision };
  }

  const suspiciousMatch =
    (guardianIp && guardianIp === approval.student_registration_ip) ||
    (guardianDeviceFingerprint &&
      guardianDeviceFingerprint === approval.student_device_fingerprint);

  approval.status = 'approved';
  approval.approved_at = new Date();
  await approval.save();

  await auditService.record({
    actorRole: 'System',
    action: suspiciousMatch ? 'GUARDIAN_APPROVED_FLAGGED_FOR_REVIEW' : 'GUARDIAN_APPROVED',
    resourceType: 'guardian_approval',
    resourceId: approval._id,
    metadata: { guardian_ip: guardianIp, guardian_full_name: guardianFullName, relationship },
    req,
  });

  if (user.email_verified_at) {
    user.status = 'active';
    await user.save();
    return { error: null, status: 'active', decision };
  }

  return { error: null, status: 'guardian_pending', decision };
}

module.exports = { registerUser, verifyEmail, resendVerification, processGuardianApproval };
