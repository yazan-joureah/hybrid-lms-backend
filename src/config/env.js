/**
 * Centralized environment configuration.
 * All env vars are read ONCE here — never use process.env directly elsewhere.
 * Source: Module_DB_Design_Specification_v1.3, REST_API_Contract_v1.2
 */
require('dotenv').config();

function required(name) {
  // eslint-disable-next-line security/detect-object-injection -- `name` is a hardcoded literal at every call site below, never user input
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Did you forget to copy .env.example to .env?`
    );
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

  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID,
    clientSecret: process.env.GMAIL_CLIENT_SECRET,
    refreshToken: process.env.GMAIL_REFRESH_TOKEN,
    senderEmail: process.env.GMAIL_SENDER_EMAIL,
  },

  privacyPolicyVersion: process.env.PRIVACY_POLICY_VERSION || 'v1.0',

  rateLimit: {
    windowMs: 10 * 60 * 1000, // 10 دقائق — نافذة عدّ المحاولات قبل القفل
    maxAttempts: 5, // نفس رقم UC-AUTH-04 لثبات المنطق عبر المشروع
    baseLockoutSeconds: 30, // أول قفل — يطابق نمط Android (30 ثانية)
    maxLockoutSeconds: 30 * 60, // سقف 30 دقيقة — توصية OWASP Testing Guide
    violationsTtlSeconds: 24 * 60 * 60, // "الذاكرة" تُنسى بعد 24 ساعة
  },

  accountLockout: {
    durationMinutes: 15, // OWASP Testing Guide: 5–30 min recommended range
  },

  encryption: {
    masterKeyHex: process.env.ENCRYPTION_MASTER_KEY,
  },
};
