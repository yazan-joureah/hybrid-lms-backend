//Centralized environment configuration.
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
  frontUrl: process.env.DEMO_FRONTEND_ORIGIN || 'http://localhost:5173',
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
    windowMs: 10 * 60 * 1000,
    maxAttempts: 5,
    baseLockoutSeconds: 30,
    maxLockoutSeconds: 30 * 60,
    violationsTtlSeconds: 24 * 60 * 60,
  },

  accountLockout: {
    durationMinutes: 15,
  },

  encryption: {
    masterKeyHex: process.env.ENCRYPTION_MASTER_KEY,
  },

  googleOAuthLogin: {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI,
  },

  stripe: {
    secretKey: required('STRIPE_SECRET_KEY'),
    webhookSecret: required('STRIPE_WEBHOOK_SECRET'),
  },

  payment: {
    currency: 'usd',
    refundWindowDays: 10,
  },

  certSigning: {
    privateKeyPem: required('CERT_SIGNING_PRIVATE_KEY_PEM'),
    publicKeyPem: required('CERT_SIGNING_PUBLIC_KEY_PEM'),
    keyVersion: process.env.CERT_SIGNING_KEY_VERSION || 'v1',
  },
};
