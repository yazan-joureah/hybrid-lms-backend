// src/services/kyc/ageCorrection.service.js
//
// نقل العبء للطالب (بدون أتمتة جديدة): الطالب المُعلَّق بـ age_flagged
// يقترح تاريخ ميلاد مصحَّح + بريد ولي أمر، فنحدّث birth_date فوراً ونقفل
// الحساب بنفس القيمة المستخدمة أصلاً لمسار القاصر (User.status =
// 'guardian_pending')، وننشئ GuardianApproval بنفس البنية الحرفية
// المستخدمة في registration.service.js. فتح القفل يتم لاحقاً عبر
// processGuardianApproval الموجودة أصلاً بدون أي تعديل هنا.

const User = require('../../models/User');
const GuardianApproval = require('../../models/GuardianApproval');
const { generateOpaqueToken } = require('../../utils/crypto');
const emailService = require('../emailService');
const auditService = require('../auditService');
const env = require('../../config/env');
const logger = require('../../utils/logger');

const GUARDIAN_APPROVAL_TTL_HOURS = 48; // نفس ثابت registration.service.js

async function requestAgeCorrection({ userId, newBirthDate, guardianEmail, req }) {
  const user = await User.findById(userId);
  if (!user) return { error: 'USER_NOT_FOUND' };

  if (user.status !== 'active') {
    return { error: 'ACCOUNT_NOT_ACTIVE' };
  }

  if (user.kyc_status !== 'age_flagged') {
    return { error: 'NOT_AGE_FLAGGED' };
  }

  if (guardianEmail.toLowerCase() === user.email?.toLowerCase()) {
    return { error: 'GUARDIAN_EMAIL_SAME_AS_STUDENT' };
  }

  const existingPending = await GuardianApproval.findOne({
    user_id: user._id,
    status: 'pending',
  });
  if (existingPending) {
    return { error: 'CORRECTION_ALREADY_PENDING' };
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

  // تحديث تاريخ الميلاد فوراً + قفل تسجيل الدخول القادم بنفس القيمة
  // المستخدمة أصلاً للقاصر — لا حالة جديدة، إعادة استخدام حرفية.
  user.birth_date = new Date(newBirthDate);
  user.status = 'guardian_pending';
  await user.save();

  const approveUrl = `${env.frontUrl}/auth/guardian/approve?token=${approvalRaw}`;
  const manageUrl = `${env.frontUrl}/auth/guardian/manage?token=${studentAccessRaw}`;

  try {
    await Promise.all([
      emailService.sendGuardianApprovalEmail(guardianEmail, approveUrl, user.full_name),
      emailService.sendGuardianWaitingEmail(user.email, manageUrl),
    ]);
  } catch (err) {
    logger.error('Age-correction guardian email(s) failed to send', {
      userId: user._id,
      error: err.message,
    });
  }

  await auditService.record({
    actorId: user._id,
    actorRole: user.role,
    action: 'AGE_CORRECTION_GUARDIAN_REQUESTED',
    resourceType: 'guardian_approval',
    resourceId: user._id,
    metadata: { new_birth_date: newBirthDate },
    req,
  });

  return { error: null };
}

module.exports = { requestAgeCorrection };
