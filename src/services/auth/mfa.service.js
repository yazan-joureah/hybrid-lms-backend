/**
 * MFA (TOTP) — Bounded Context.
 * Source: UC-AUTH-09 (Setup MFA), UC-AUTH-05 (Enforce MFA during Login).
 */
const User = require('../../models/User');
const MFAConfiguration = require('../../models/MFAConfiguration');
const BackupCode = require('../../models/BackupCode');
const {
  generateEncryptedTotpSecret,
  buildProvisioningUri,
  verifyTotpCode,
} = require('../../utils/totp');
const { hashPassword, verifyPassword, generateOpaqueToken } = require('../../utils/crypto');
const { verifyMfaTempToken, JwtError } = require('../../utils/jwt');
const { createUserSession, computeRedirectTo } = require('./session.service');
const auditService = require('../auditService');

const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_BYTES = 6;

/** POST /auth/mfa/totp/setup — UC-AUTH-09 steps 1-4. Does NOT enable MFA yet. */
async function setupTotp({ userId, req }) {
  const user = await User.findById(userId);
  if (!user) {
    return { error: 'USER_NOT_FOUND' };
  }

  const { rawSecret, encryptedSecret } = generateEncryptedTotpSecret();

  await MFAConfiguration.findOneAndUpdate(
    { user_id: userId },
    {
      $set: {
        user_id: userId,
        method: 'TOTP',
        secret_encrypted: encryptedSecret,
        enabled: false,
        verified_at: null,
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );

  const provisioningUri = buildProvisioningUri(rawSecret, user.email);

  await auditService.record({
    actorId: user._id,
    actorRole: user.role,
    action: 'MFA_TOTP_SETUP_STARTED',
    resourceType: 'user',
    resourceId: user._id,
    req,
  });

  return { error: null, provisioningUri, rawSecret };
}

/** POST /auth/mfa/totp/verify — UC-AUTH-09 steps 5-8. Activates MFA on User AND MFAConfiguration. */
async function confirmTotpSetup({ userId, code, req }) {
  const mfaConfig = await MFAConfiguration.findOne({ user_id: userId });

  if (!mfaConfig || !mfaConfig.secret_encrypted) {
    return { error: 'NO_PENDING_SETUP' };
  }
  if (mfaConfig.enabled) {
    return { error: 'ALREADY_ENABLED' };
  }

  const isValid = await verifyTotpCode(mfaConfig.secret_encrypted, code);
  if (!isValid) {
    return { error: 'INVALID_CODE' };
  }

  mfaConfig.enabled = true;
  mfaConfig.verified_at = new Date();
  await mfaConfig.save();

  await User.updateOne({ _id: userId }, { $set: { mfa_enabled: true } });

  const rawBackupCodes = [];
  const backupCodeDocs = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i += 1) {
    const { raw } = generateOpaqueToken(BACKUP_CODE_BYTES);
    // eslint-disable-next-line no-await-in-loop -- sequential Argon2id, negligible one-time cost
    const codeHash = await hashPassword(raw);
    rawBackupCodes.push(raw);
    backupCodeDocs.push({
      mfa_config_id: mfaConfig._id,
      user_id: userId,
      code_hash: codeHash,
      used: false,
    });
  }
  await BackupCode.insertMany(backupCodeDocs);

  await auditService.record({
    actorId: userId,
    actorRole: 'System',
    action: 'MFA_TOTP_ENABLED',
    resourceType: 'user',
    resourceId: userId,
    metadata: { backup_codes_issued: BACKUP_CODE_COUNT },
    req,
  });

  return { error: null, backupCodes: rawBackupCodes };
}

/**
 * POST /auth/mfa/login/verify — completes UC-AUTH-05's MFA challenge
 * issued by loginUser().
 *
 * يقبل إما رمز TOTP (6 أرقام) أو رمز نسخ احتياطي واحد الاستخدام. الأول
 * يُحدَّد شكلياً (6 أرقام بالضبط) ويُتحقَّق منه عبر TOTP مباشرة؛ أي شكل
 * آخر يُعامَل كمحاولة backup code — بما إنها مُخزَّنة كـ hash (Argon2id)
 * لا يمكن الاستعلام عنها مباشرة، فنفحص كل الرموز غير المُستخدَمة لهذا
 * المستخدم (حد أقصى BACKUP_CODE_COUNT=10، تكلفة مقبولة لعملية دخول واحدة).
 */
async function completeMfaLogin({ mfaTempToken, code, req }) {
  let decoded;
  try {
    decoded = verifyMfaTempToken(mfaTempToken);
  } catch (err) {
    if (err instanceof JwtError) {
      return { error: err.code === 'EXPIRED' ? 'MFA_CHALLENGE_EXPIRED' : 'MFA_CHALLENGE_INVALID' };
    }
    throw err;
  }

  const user = await User.findById(decoded.sub);
  if (!user || !user.mfa_enabled) {
    return { error: 'MFA_CHALLENGE_INVALID' };
  }

  const mfaConfig = await MFAConfiguration.findOne({ user_id: user._id });
  if (!mfaConfig || !mfaConfig.enabled) {
    return { error: 'MFA_CHALLENGE_INVALID' };
  }

  const looksLikeTotp = /^\d{6}$/.test(code);
  let isValid = false;
  let matchedBackupCode = null;

  if (looksLikeTotp) {
    isValid = await verifyTotpCode(mfaConfig.secret_encrypted, code);
  }

  // Fallback إلى backup codes: إما لأن الشكل مش TOTP أصلاً، أو TOTP فشل
  // (نسمح بالمحاولتين على نفس القيمة تحسباً لتشابه صدفوي بالشكل — نادر
  // لكن غير مستحيل نظرياً، والتكلفة الإضافية هنا مقبولة).
  if (!isValid) {
    const unusedCodes = await BackupCode.find({
      user_id: user._id,
      mfa_config_id: mfaConfig._id,
      used: false,
    });

    for (const backupCode of unusedCodes) {
      // eslint-disable-next-line no-await-in-loop -- سلسلة Argon2id على حد أقصى 10 عناصر، تكلفة عملية دخول واحدة لا أكثر
      const matches = await verifyPassword(code, backupCode.code_hash);
      if (matches) {
        isValid = true;
        matchedBackupCode = backupCode;
        break;
      }
    }
  }

  if (!isValid) {
    await auditService.record({
      actorId: user._id,
      actorRole: user.role,
      action: 'MFA_LOGIN_CODE_REJECTED',
      resourceType: 'user',
      resourceId: user._id,
      req,
    });
    return { error: 'INVALID_CODE' };
  }

  // رمز احتياطي واحد الاستخدام — يُعطَّل فوراً بعد نجاح المطابقة، قبل أي
  // خطوة لاحقة، حتى لا يُستخدَم مرتين حتى لو فشلت خطوة تالية لاحقاً.
  if (matchedBackupCode) {
    matchedBackupCode.used = true;
    matchedBackupCode.used_at = new Date();
    await matchedBackupCode.save();

    await auditService.record({
      actorId: user._id,
      actorRole: user.role,
      action: 'MFA_BACKUP_CODE_USED',
      resourceType: 'user',
      resourceId: user._id,
      metadata: { backup_code_id: matchedBackupCode._id },
      req,
    });
  }

  const { accessToken, refreshTokenRaw, session } = await createUserSession({ user, req });

  session.mfa_verified = true;
  await session.save();

  await auditService.record({
    actorId: user._id,
    actorRole: user.role,
    action: matchedBackupCode ? 'LOGIN_SUCCESS_VIA_MFA_BACKUP_CODE' : 'LOGIN_SUCCESS_VIA_MFA',
    resourceType: 'user',
    resourceId: user._id,
    req,
  });

  return {
    error: null,
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

module.exports = { setupTotp, confirmTotpSetup, completeMfaLogin };
