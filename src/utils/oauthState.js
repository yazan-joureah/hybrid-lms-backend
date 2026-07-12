/**
 * OAuth `state` parameter management (MUC-AUTH-14 — CSRF/session-fixation
 * protection for the OAuth flow specifically, distinct from the
 * Double-Submit Cookie CSRF built for /auth/refresh).
 *
 * Storage: Redis, TTL 10 minutes — this exact combination is NOT invented
 * here; it's already documented in REST_API_Contract_v1.2 §1's general
 * principles table ("CSRF OAuth State | Redis — TTL 10 دقائق —
 * MUC-AUTH-14"), even though Groups 5-8 themselves were never written up.
 */
const crypto = require('crypto');
const redisClient = require('../config/redis');

const STATE_TTL_SECONDS = 10 * 60;
const STATE_KEY_PREFIX = 'oauth:state:';

/**
 * Generates a fresh state value and stores it in Redis. The VALUE itself
 * is the key (not a separately generated ID) — simplest possible
 * correct design: "does this exact state value exist in our pending set?"
 */
async function createState() {
  const state = crypto.randomBytes(32).toString('base64url');
  await redisClient.set(`${STATE_KEY_PREFIX}${state}`, '1', 'EX', STATE_TTL_SECONDS);
  return state;
}

/**
 * Validates AND consumes a state value in one atomic step — using GETDEL
 * (not GET followed by a separate DEL) so that even two concurrent
 * requests presenting the exact same state cannot both succeed. This is
 * the same one-time-use discipline already applied to AuthToken/
 * GuardianApproval tokens (DP-08), now enforced at the Redis layer.
 */
async function consumeState(state) {
  if (!state) return false;
  const existed = await redisClient.getdel(`${STATE_KEY_PREFIX}${state}`);
  return existed !== null;
}

module.exports = { createState, consumeState };
