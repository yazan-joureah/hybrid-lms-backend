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

// Define all values as constants
const nodeEnv = process.env.NODE_ENV || 'development';
const port = parseInt(process.env.PORT, 10) || 3000;
const appUrl = process.env.APP_URL || 'http://localhost:3000';
const frontUrl = process.env.DEMO_FRONTEND_ORIGIN || 'http://localhost:5173';
const mongoUri = required('MONGO_URI');
const redisUrl = required('REDIS_URL');

const jwt = {
  accessSecret: required('JWT_ACCESS_SECRET'),
  accessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
  refreshExpiresDays: parseInt(process.env.REFRESH_TOKEN_EXPIRES_DAYS, 10) || 7,
};

const argon2 = {
  memoryKB: parseInt(process.env.ARGON2_MEMORY_KB, 10) || 65536,
  timeCost: parseInt(process.env.ARGON2_TIME_COST, 10) || 3,
  parallelism: parseInt(process.env.ARGON2_PARALLELISM, 10) || 1,
};

const gmail = {
  clientId: process.env.GMAIL_CLIENT_ID,
  clientSecret: process.env.GMAIL_CLIENT_SECRET,
  refreshToken: process.env.GMAIL_REFRESH_TOKEN,
  senderEmail: process.env.GMAIL_SENDER_EMAIL,
};

const privacyPolicyVersion = process.env.PRIVACY_POLICY_VERSION || 'v1.0';

const rateLimit = {
  windowMs: 10 * 60 * 1000,
  maxAttempts: 5,
  baseLockoutSeconds: 30,
  maxLockoutSeconds: 30 * 60,
  violationsTtlSeconds: 24 * 60 * 60,
};

const accountLockout = {
  durationMinutes: 15,
};

const encryption = {
  masterKeyHex: process.env.ENCRYPTION_MASTER_KEY,
};

const googleOAuthLogin = {
  clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
  clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI,
};

const stripe = {
  secretKey: required('STRIPE_SECRET_KEY'),
  webhookSecret: required('STRIPE_WEBHOOK_SECRET'),
};

const payment = {
  currency: 'usd',
  refundWindowDays: 10,
};

const certSigning = {
  privateKeyPem: required('CERT_SIGNING_PRIVATE_KEY_PEM').replace(/\\n/g, '\n'),
  publicKeyPem: required('CERT_SIGNING_PUBLIC_KEY_PEM').replace(/\\n/g, '\n'),
  keyVersion: process.env.CERT_SIGNING_KEY_VERSION || 'v1',
};

const openBadges = {
  issuerId: process.env.OPEN_BADGES_ISSUER_ID || `${appUrl}/issuers/hybrid-lms`,
  issuerName: process.env.OPEN_BADGES_ISSUER_NAME || 'Hybrid LMS',
  issuerLogoUrl: process.env.OPEN_BADGES_ISSUER_LOGO_URL || null,
};

module.exports = {
  nodeEnv,
  port,
  appUrl,
  frontUrl,
  mongoUri,
  redisUrl,
  jwt,
  argon2,
  gmail,
  privacyPolicyVersion,
  rateLimit,
  accountLockout,
  encryption,
  googleOAuthLogin,
  stripe,
  payment,
  certSigning,
  openBadges,
};
