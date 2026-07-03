/**
 * Redis client (ioredis).
 * Used for: rate limiting, OAuth CSRF state, OTP transient storage (future modules).
 */
const Redis = require('ioredis');
const logger = require('../utils/logger');
const env = require('./env');

const redisClient = new Redis(env.redisUrl, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redisClient.on('error', (err) => {
  logger.error('Redis error', { error: err.message });
});

redisClient.on('connect', () => {
  logger.info('Redis connected');
});

module.exports = redisClient;
