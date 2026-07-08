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

module.exports = { hashPassword, verifyPassword, generateOpaqueToken, sha256 };
