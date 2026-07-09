/**
 * MFA (TOTP) — Bounded Context.
 * Source: UC-AUTH-09 (Setup MFA via TOTP). REST contract self-designed
 * (Groups 5-8 have no official REST_API_Contract document — see prior
 * design discussion): POST /auth/mfa/totp/setup, POST /auth/mfa/totp/verify.
 */
const User = require('../../models/User');
const MFAConfiguration = require('../../models/MFAConfiguration');
const BackupCode = require('../../models/BackupCode');
const {
  generateEncryptedTotpSecret,
  buildProvisioningUri,
  verifyTotpCode,
} = require('../../utils/totp');
const { hashPassword, generateOpaqueToken } = require('../../utils/crypto');
const auditService = require('../auditService');

const BACKUP_CODE_COUNT = 10; // Industry convention (Google, GitHub) — UC-AUTH-09 doesn't pin an exact number
const BACKUP_CODE_BYTES = 6; // 48 bits of entropy per code — exceeds Google's own 8-digit (~26.6-bit) backup codes

/**
 * POST /auth/mfa/totp/setup — UC-AUTH-09 steps 1-4.
 * Does NOT enable MFA yet — only stores a PENDING encrypted secret and
 * returns the QR provisioning URI. MFA becomes active only after
 * confirmTotpSetup() proves the user actually scanned it correctly
 * (closes the "locked out immediately" failure mode discussed earlier).
 *
 * Idempotent-by-overwrite: calling this again before confirming (e.g. the
 * user failed to scan and wants a fresh QR) simply replaces the pending
 * secret — no orphaned half-configured state accumulates.
 */
async function setupTotp(userId, req) {
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

  // rawSecret is returned ONLY in this single response (manual-entry
  // fallback alongside the QR code) — never persisted, never logged.
  return { error: null, provisioningUri, rawSecret };
}

/**
 * POST /auth/mfa/totp/verify — UC-AUTH-09 steps 5-8.
 * Confirms the first TOTP code, activates MFA on BOTH MFAConfiguration
 * AND User.mfa_enabled — this second write is the critical integration
 * point: loginUser() (session.service.js) branches into the MFA flow by
 * reading User.mfa_enabled specifically, not MFAConfiguration.enabled.
 * Forgetting this second write would mean MFA appears "set up" but is
 * NEVER actually enforced at login — a silent, dangerous gap.
 */
async function confirmTotpSetup(userId, code, req) {
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
    // eslint-disable-next-line no-await-in-loop -- Argon2id hashing is
    // intentionally sequential here; 10 iterations during a one-time
    // setup action is negligible cost versus the complexity of
    // parallelizing it.
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

  // Raw backup codes are returned ONCE, here, and never again — matches
  // UC-AUTH-09 step 7 ("تُعرَض مرة واحدة فقط") and DP-08.
  return { error: null, backupCodes: rawBackupCodes };
}

module.exports = { setupTotp, confirmTotpSetup };
