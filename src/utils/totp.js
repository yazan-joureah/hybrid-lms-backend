/**
 * TOTP (Time-based One-Time Password) — thin wrapper over `otplib`.
 * Source: UC-AUTH-09 (Setup MFA via TOTP), SF-AUTH-02 (Verify MFA Code).
 *
 * Library choice (verified against RFC 6238 compliance + independently
 * audited crypto backends — @noble/hashes, @scure/base): otplib v13.
 *
 * Design decision: the RAW secret exists in memory ONLY transiently
 * (during setup, to build the QR code and confirm the first code) — it
 * is NEVER persisted as-is. `MFAConfiguration.secret_encrypted` always
 * stores the AES-256-GCM ciphertext from crypto.js's encryptSecret(),
 * never the plaintext Base32 secret.
 */
const { generateSecret, verify, generateURI } = require('otplib');
const { encryptSecret, decryptSecret } = require('./crypto');

const APP_ISSUER_NAME = 'Hybrid LMS';

/**
 * Generates a fresh Base32 secret and the corresponding AES-256-GCM
 * encrypted form to persist. Returns BOTH — the raw secret is used
 * ONCE by the caller to build the QR code response, then discarded;
 * only `encryptedSecret` is written to MFAConfiguration.secret_encrypted.
 */
function generateEncryptedTotpSecret() {
  const rawSecret = generateSecret();
  const encryptedSecret = encryptSecret(rawSecret);
  return { rawSecret, encryptedSecret };
}

/**
 * Builds the otpauth:// URI that becomes the QR code content. The user's
 * email is used as the label so their authenticator app (Google
 * Authenticator, Authy, etc.) displays which account this code belongs
 * to — matching UC-AUTH-09 step 2 exactly ("اسم التطبيق + بريد المستخدم").
 */
function buildProvisioningUri(rawSecret, userEmail) {
  return generateURI({
    issuer: APP_ISSUER_NAME,
    label: userEmail,
    secret: rawSecret,
  });
}

/**
 * Verifies a 6-digit code against an ENCRYPTED secret pulled from the
 * database — decrypts internally, verifies, and returns a plain boolean.
 * Callers never handle the raw secret directly.
 */
async function verifyTotpCode(encryptedSecret, code) {
  const rawSecret = decryptSecret(encryptedSecret);
  const result = await verify({ secret: rawSecret, token: code });
  return result.valid;
}

module.exports = { generateEncryptedTotpSecret, buildProvisioningUri, verifyTotpCode };
