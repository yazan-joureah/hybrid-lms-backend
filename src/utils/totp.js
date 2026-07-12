/**
 * Self-contained RFC 6238 TOTP implementation — Node built-in `crypto`
 * only, ZERO external dependencies. Replaces `otplib` after its default
 * Base32 plugin (@otplib/plugin-base32-scure → @scure/base) proved
 * incompatible with this project's plain CommonJS runtime (ERR_REQUIRE_ESM
 * at `otplib`'s own top-level import, unrelated to our call-site code).
 *
 * Verified against the OFFICIAL RFC 4226 Appendix D test vectors
 * (secret="12345678901234567890", counters 0-9) — all 10 match exactly.
 * See project chat log for the verification script and output.
 */
const crypto = require('crypto');
const { encryptSecret, decryptSecret } = require('./crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TIME_STEP_SECONDS = 30; // RFC 6238 default
const CODE_DIGITS = 6;
const SECRET_BYTES = 20; // 160 bits — RFC 4226 recommended minimum
const VERIFY_WINDOW_STEPS = 1; // ±30s tolerance, matches UC-AUTH-02 SF-AUTH-02 ("النافذة الزمنية 30 ثانية ±1")
const APP_ISSUER_NAME = 'Hybrid LMS';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buffer.length; i += 1) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(str) {
  const clean = str.toUpperCase().replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const output = [];
  for (let i = 0; i < clean.length; i += 1) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) throw new Error('Invalid Base32 character in TOTP secret');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

/** RFC 4226 HOTP — the counter-based primitive TOTP builds on. */
function hotp(secretBuffer, counter) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secretBuffer).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (binary % 10 ** CODE_DIGITS).toString().padStart(CODE_DIGITS, '0');
}

function generateEncryptedTotpSecret() {
  const rawSecret = base32Encode(crypto.randomBytes(SECRET_BYTES));
  const encryptedSecret = encryptSecret(rawSecret);
  return { rawSecret, encryptedSecret };
}

function buildProvisioningUri(rawSecret, userEmail) {
  const label = encodeURIComponent(`${APP_ISSUER_NAME}:${userEmail}`);
  const issuer = encodeURIComponent(APP_ISSUER_NAME);
  return `otpauth://totp/${label}?secret=${rawSecret}&issuer=${issuer}&algorithm=SHA1&digits=${CODE_DIGITS}&period=${TIME_STEP_SECONDS}`;
}

/**
 * Verifies a code within a ±1 time-step window (matches SF-AUTH-02's
 * documented tolerance). Uses crypto.timingSafeEqual — NOT `===` — to
 * prevent timing-attack-based code guessing (same discipline already
 * applied to Argon2id comparison in crypto.js).
 */
async function verifyTotpCode(encryptedSecret, code) {
  if (!/^\d{6}$/.test(code)) return false; // defensive; Zod already enforces this at the route layer

  const rawSecret = decryptSecret(encryptedSecret);
  const secretBuffer = base32Decode(rawSecret);
  const currentStep = Math.floor(Date.now() / 1000 / TIME_STEP_SECONDS);

  for (let drift = -VERIFY_WINDOW_STEPS; drift <= VERIFY_WINDOW_STEPS; drift += 1) {
    const candidate = hotp(secretBuffer, currentStep + drift);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(code))) {
      return true;
    }
  }
  return false;
}

/**
 * Generates a valid 6-digit TOTP code from a raw Base32 secret.
 * Used primarily by the test suite to simulate an authenticator app.
 */
function generateTotpCode(rawSecret) {
  const secretBuffer = base32Decode(rawSecret);
  const currentStep = Math.floor(Date.now() / 1000 / TIME_STEP_SECONDS);
  return hotp(secretBuffer, currentStep);
}

module.exports = {
  generateEncryptedTotpSecret,
  buildProvisioningUri,
  verifyTotpCode,
  generateTotpCode,
};
