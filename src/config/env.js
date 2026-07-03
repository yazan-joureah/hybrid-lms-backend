/**
 * Centralized environment configuration.
 * All env vars are read ONCE here — never use process.env directly elsewhere.
 * Source: Module_DB_Design_Specification_v1.3, REST_API_Contract_v1.2
 */
require('dotenv').config();

function required(name) {
  // eslint-disable-next-line security/detect-object-injection -- `name` is a hardcoded literal at every call site below, never user input
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  appUrl: process.env.APP_URL || 'http://localhost:3000',

  mongoUri: required('MONGO_URI'),
  redisUrl: required('REDIS_URL'),

  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET'),
    accessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
    refreshExpiresDays: parseInt(process.env.REFRESH_TOKEN_EXPIRES_DAYS, 10) || 7,
  },

  argon2: {
    memoryKB: parseInt(process.env.ARGON2_MEMORY_KB, 10) || 65536,
    timeCost: parseInt(process.env.ARGON2_TIME_COST, 10) || 3,
    parallelism: parseInt(process.env.ARGON2_PARALLELISM, 10) || 1,
  },

  email: {
    provider: process.env.EMAIL_PROVIDER || 'smtp',
    smtpHost: process.env.SMTP_HOST,
    smtpPort: parseInt(process.env.SMTP_PORT, 10) || 587,
    smtpUser: process.env.SMTP_USER,
    smtpPass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || 'Hybrid LMS <no-reply@hybridlms.local>',
  },

  privacyPolicyVersion: process.env.PRIVACY_POLICY_VERSION || 'v1.0',

  turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY,

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    maxAttempts: parseInt(process.env.RATE_LIMIT_MAX_ATTEMPTS, 10) || 5,
  },
};
