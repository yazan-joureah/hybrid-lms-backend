/**
 * Cryptographic utilities.
 *
 * Password hashing: Argon2id via @node-rs/argon2.
 * Parameters (m=64MB, t=3, p=1) match the OWASP Password Storage Cheat Sheet
 
 * Token hashing: SHA-256 (Node built-in `crypto`) — per DP-08, transient
 * tokens (email verification, password reset, guardian approval, etc.) are
 * NEVER stored as plaintext, only as a hash of the value sent to the user.
 */

const nodeCrypto = require('crypto');
const argon2 = require('@node-rs/argon2');
const env = require('../config/env');

async function hashPassword(plainPassword) {
  return argon2.hash(plainPassword, {
    memoryCost: env.argon2.memoryKB,
    timeCost: env.argon2.timeCost,
    parallelism: env.argon2.parallelism,
    algorithm: argon2.Algorithm.Argon2id,
  });
}

async function verifyPassword(plainPassword, hash) {
  // @node-rs/argon2 performs constant-time comparison internally,
  // preventing timing-attack based password guessing (OWASP A07).
  return argon2.verify(hash, plainPassword);
}

/**
 * Generates a cryptographically secure random token (URL-safe) to be sent
 * to the user (email link / body param), and returns both the raw value
 * (sent once, never persisted) and its SHA-256 hash (persisted in DB).
 */

function generateOpaqueToken(byteLength = 32) {
  const raw = nodeCrypto.randomBytes(byteLength).toString('base64url');
  const hash = sha256(raw);
  return { raw, hash };
}

function sha256(value) {
  return nodeCrypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Symmetric encryption (AES-256-GCM) for data that must be DECRYPTABLE
 * later (unlike password/token hashing above, which is one-way).
 * Use cases: MFAConfiguration.secret_encrypted (UC-AUTH-09), and later
 * KYCDocument encryption (FR-47) — deliberately generic, not TOTP-specific.
 *
 * GCM mode chosen (not CBC) because it provides AUTHENTICATED encryption:
 * the auth tag detects any tampering with the ciphertext, not just
 * confidentiality. A 12-byte (96-bit) IV is used per NIST SP 800-38D's
 * recommendation for GCM specifically (the "advantageous" IV length).
 */
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const GCM_IV_BYTES = 12;

function getEncryptionKey() {
  const key = Buffer.from(env.encryption.masterKeyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_MASTER_KEY must decode to exactly 32 bytes (AES-256)');
  }
  return key;
}

/**
 * Encrypts plaintext and packs [iv | authTag | ciphertext] into a single
 * Base64 string — this lets a single DB column (e.g. secret_encrypted)
 * hold everything needed to decrypt later, with no extra columns.
 */
function encryptSecret(plaintext) {
  const iv = nodeCrypto.randomBytes(GCM_IV_BYTES);
  const cipher = nodeCrypto.createCipheriv(ENCRYPTION_ALGORITHM, getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

/**
 * Reverses encryptSecret(). Throws if the auth tag doesn't match —
 * meaning EITHER the wrong key was used OR the stored value was
 * tampered with. Both cases must fail loudly, never silently return
 * garbage plaintext.
 */
function decryptSecret(encryptedBase64) {
  const data = Buffer.from(encryptedBase64, 'base64');
  const iv = data.subarray(0, GCM_IV_BYTES);
  const authTag = data.subarray(GCM_IV_BYTES, GCM_IV_BYTES + 16); // GCM auth tag is always 16 bytes
  const ciphertext = data.subarray(GCM_IV_BYTES + 16);

  const decipher = nodeCrypto.createDecipheriv(ENCRYPTION_ALGORITHM, getEncryptionKey(), iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateOpaqueToken,
  sha256,
  encryptSecret,
  decryptSecret,
};
