/**
 * Registration & Guardian Approval — Bounded Context.
 * Extracted from the monolithic authService.js (642 lines) during the
 * Refactor phase. Pure structural move — ZERO behavioral change. Every
 * function body below is byte-identical to its previous location.
 *
 * Covers: UC-AUTH-01 (Register), UC-AUTH-02 (Guardian Approval),
 * email verification's State Machine (Module_DB_Design_Specification_v1.3).
 */
const User = require('../../models/User');
const AuthToken = require('../../models/AuthToken');
const GuardianApproval = require('../../models/GuardianApproval');
const { hashPassword, generateOpaqueToken, sha256 } = require('../../utils/crypto');
const { isMinor } = require('../../utils/ageCalculator');
const emailService = require('../emailService');
const auditService = require('../auditService');
const env = require('../../config/env');
const logger = require('../../utils/logger');

const EMAIL_VERIFICATION_TTL_HOURS = 24;
const GUARDIAN_APPROVAL_TTL_HOURS = 48;

/**
 * Registers a new user. ALWAYS returns the same shape of success response
 * regardless of whether the email already existed, to prevent User
 * Enumeration (OWASP A07, MUC-AUTH-04).
 */
async function registerUser(input, req) {
  // check if user already exsists
  const existing = await User.findOne({ email: input.email }).lean();
  if (existing) {
    logger.debug('Register attempt for existing email — returning generic success');
    return { alreadyExisted: true, requiresGuardianApproval: false };
  }

  const passwordHash = await hashPassword(input.password);
  const minor = isMinor(input.birth_date);

  const user = await User.create({
    full_name: input.full_name,
    email: input.email,
    password_hash: passwordHash,
    birth_date: new Date(input.birth_date),
    role: input.role,
    status: 'pending_email_verification',
    privacy_consent: {
      policy_version: input.privacy_consent_version,
      accepted_at: new Date(),
      ip: req.ip,
      user_agent: req.get('user-agent') || 'unknown',
    },
    terms_accepted_at: input.role === 'Student' ? new Date() : null,
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

  const { raw: verifyRaw, hash: verifyHash } = generateOpaqueToken();
  await AuthToken.create({
    user_id: user._id,
    token_hash: verifyHash,
    token_type: 'EMAIL_VERIFICATION',
    expires_at: new Date(Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000),
  });
  const verifyUrl = `${env.frontUrl}/verify-email?token=${verifyRaw}`;
  try {
    await emailService.sendVerificationEmail(user.email, verifyUrl);
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
      guardian_email: input.guardian_email,
      approval_token_hash: approvalHash,
      student_access_token_hash: studentAccessHash,
      status: 'pending',
      expires_at: new Date(Date.now() + GUARDIAN_APPROVAL_TTL_HOURS * 60 * 60 * 1000),
      student_registration_ip: req.ip,
      student_device_fingerprint: req.get('x-device-fingerprint') || null,
    });

    const approveUrl = `${env.frontUrl}/guardian-approve?token=${approvalRaw}`;
    const manageUrl = `${env.frontUrl}/auth/guardian/manage?token=${studentAccessRaw}`;

    try {
      await Promise.all([
        emailService.sendGuardianApprovalEmail(input.guardian_email, approveUrl, user.full_name),
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

/**
 * Completes email verification (GET /auth/verify-email).
 * State machine (CLOSED DECISION — Module_DB_Design_Specification_v1.3):
 *   status = active ⟺ email_verified_at ≠ null AND (adult OR GuardianApproval.approved_at ≠ null)
 */
async function verifyEmail(rawToken, req) {
  const tokenHash = sha256(rawToken);

  const authToken = await AuthToken.findOne({
    token_hash: tokenHash,
    token_type: 'EMAIL_VERIFICATION',
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

/**
 * Handles POST /auth/guardian/approve — the guardian's decision.
 * Fraud-detection note (MUC-AUTH-09, CLOSED DECISION): a matching
 * IP/fingerprint between guardian and student FLAGS, never BLOCKS.
 */
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

module.exports = { registerUser, verifyEmail, processGuardianApproval };
