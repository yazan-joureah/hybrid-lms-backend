// tests/unit/env.test.js
jest.mock('dotenv', () => ({ config: jest.fn() }));

const REQUIRED_KEYS = [
  'MONGO_URI',
  'REDIS_URL',
  'JWT_ACCESS_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'CERT_SIGNING_PRIVATE_KEY_PEM',
  'CERT_SIGNING_PUBLIC_KEY_PEM',
];

function setAllRequiredEnvVars() {
  process.env.MONGO_URI = 'mongodb://localhost/test';
  process.env.REDIS_URL = 'redis://localhost';
  process.env.JWT_ACCESS_SECRET = 'test-secret';
  process.env.STRIPE_SECRET_KEY = 'sk_test';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  process.env.CERT_SIGNING_PRIVATE_KEY_PEM = 'PRIVATE';
  process.env.CERT_SIGNING_PUBLIC_KEY_PEM = 'PUBLIC';
}

function clearAllEnv() {
  [...REQUIRED_KEYS, 'NODE_ENV', 'PORT', 'APP_URL', 'DEMO_FRONTEND_ORIGIN', 'AI_PROVIDER'].forEach(
    (k) => delete process.env[k]
  );
}

describe('config/env.js — required() (فرع الرمي مقابل النجاح)', () => {
  beforeEach(() => {
    jest.resetModules();
    clearAllEnv();
  });

  it('يرمي خطأً واضحاً يذكر اسم المتغيّر عند غياب MONGO_URI', () => {
    setAllRequiredEnvVars();
    delete process.env.MONGO_URI;
    expect(() => require('../../src/config/env')).toThrow(
      /Missing required environment variable: MONGO_URI/
    );
  });

  it('يرمي خطأً واضحاً عند غياب STRIPE_WEBHOOK_SECRET أيضاً (كل استدعاء required() منفصل)', () => {
    setAllRequiredEnvVars();
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(() => require('../../src/config/env')).toThrow(
      /Missing required environment variable: STRIPE_WEBHOOK_SECRET/
    );
  });

  it('يُحمَّل بنجاح عند توفر كل المتغيرات الإلزامية', () => {
    setAllRequiredEnvVars();
    const env = require('../../src/config/env');
    expect(env.mongoUri).toBe('mongodb://localhost/test');
  });
});

describe('config/env.js — القيم الافتراضية عبر || (كلا الفرعين)', () => {
  beforeEach(() => {
    jest.resetModules();
    clearAllEnv();
    setAllRequiredEnvVars();
  });

  it('nodeEnv يسقط على "development" عند غياب NODE_ENV', () => {
    const env = require('../../src/config/env');
    expect(env.nodeEnv).toBe('development');
  });

  it('nodeEnv يأخذ القيمة الصريحة عند وجودها', () => {
    process.env.NODE_ENV = 'production';
    const env = require('../../src/config/env');
    expect(env.nodeEnv).toBe('production');
  });

  it('port يسقط على 3000 عند غياب PORT', () => {
    const env = require('../../src/config/env');
    expect(env.port).toBe(3000);
  });

  it('port يأخذ القيمة الصريحة عند وجودها', () => {
    process.env.PORT = '8080';
    const env = require('../../src/config/env');
    expect(env.port).toBe(8080);
  });

  it('openBadges.issuerLogoUrl يسقط على null عند غياب المتغيّر المقابل', () => {
    const env = require('../../src/config/env');
    expect(env.openBadges.issuerLogoUrl).toBeNull();
  });

  it('ai.provider يسقط على "stub" عند غياب AI_PROVIDER', () => {
    const env = require('../../src/config/env');
    expect(env.ai.provider).toBe('stub');
  });

  it('ai.provider يأخذ القيمة الصريحة عند وجودها', () => {
    process.env.AI_PROVIDER = 'tinyllama';
    const env = require('../../src/config/env');
    expect(env.ai.provider).toBe('tinyllama');
  });
});
