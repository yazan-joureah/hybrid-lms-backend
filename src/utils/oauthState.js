const crypto = require('crypto');
const redisClient = require('../config/redis');

const STATE_TTL_SECONDS = 10 * 60;
const STATE_KEY_PREFIX = 'oauth:state:';

/**
 * Generates a fresh state value and stores it in Redis. The VALUE itself
 * is the key (not a separately generated ID)
 */
async function createState() {
  const state = crypto.randomBytes(32).toString('base64url');
  await redisClient.set(`${STATE_KEY_PREFIX}${state}`, '1', 'EX', STATE_TTL_SECONDS);
  return state;
}

/**
 * Validates AND consumes a state value in one atomic step
 */
async function consumeState(state) {
  if (!state) return false;
  const existed = await redisClient.getdel(`${STATE_KEY_PREFIX}${state}`);
  return existed !== null;
}

module.exports = { createState, consumeState };
