/**
 * Integration test for POST /auth/mfa/totp/setup + POST /auth/mfa/totp/verify.
 *
 * Token retrieval strategy: unlike email-based tokens, a TOTP code can be
 * computed DETERMINISTICALLY from the raw secret using the same otplib
 * `generate()` function the app itself uses — no email scraping or spying
 * needed. We call POST /setup for real (full HTTP path), extract
 * `manual_entry_key` (the raw secret) from the real response, then
 * generate a valid live code from it exactly as an authenticator app would.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const { generateTotpCode } = require('../../src/utils/totp');
const app = require('../../src/app');
const User = require('../../src/models/User');
const MFAConfiguration = require('../../src/models/MFAConfiguration');
const BackupCode = require('../../src/models/BackupCode');
const { hashPassword } = require('../../src/utils/crypto');
const redisClient = require('../../src/config/redis');

const PLAIN_PASSWORD = 'a-genuinely-long-passphrase-2026';

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI);
  }
}, 20000);

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    MFAConfiguration.deleteMany({}),
    BackupCode.deleteMany({}),
  ]);
  await redisClient.flushdb();
});

afterAll(async () => {
  await mongoose.connection.close();
  await redisClient.quit();
});

async function createActiveUserAndLogin() {
  const passwordHash = await hashPassword(PLAIN_PASSWORD);
  await User.create({
    full_name: 'MFA Test User',
    email: 'mfa.test@example.com',
    password_hash: passwordHash,
    birth_date: new Date('1995-06-20'),
    role: 'Student',
    status: 'active',
    email_verified_at: new Date(),
    privacy_consent: {
      policy_version: 'v1.0',
      accepted_at: new Date(),
      ip: '127.0.0.1',
      user_agent: 'jest',
    },
  });

  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'mfa.test@example.com', password: PLAIN_PASSWORD });

  return loginRes.body.data.access_token;
}

describe('POST /auth/mfa/totp/setup', () => {
  it('returns a QR data URL and a manual entry key, without enabling MFA yet', async () => {
    const accessToken = await createActiveUserAndLogin();

    const res = await request(app)
      .post('/api/v1/auth/mfa/totp/setup')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.qr_code_data_url).toMatch(/^data:image\/png;base64,/);
    expect(res.body.data.manual_entry_key).toBeTruthy();

    const user = await User.findOne({ email: 'mfa.test@example.com' });
    expect(user.mfa_enabled).toBe(false); // NOT enabled until verify

    const config = await MFAConfiguration.findOne({ user_id: user._id });
    expect(config.enabled).toBe(false);
    expect(config.secret_encrypted).toBeTruthy();
  });

  it('rejects with 401 when no Authorization header is sent', async () => {
    const res = await request(app).post('/api/v1/auth/mfa/totp/setup');
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/mfa/totp/verify — success path', () => {
  it('enables MFA on BOTH MFAConfiguration and User, and issues 10 backup codes', async () => {
    const accessToken = await createActiveUserAndLogin();

    const setupRes = await request(app)
      .post('/api/v1/auth/mfa/totp/setup')
      .set('Authorization', `Bearer ${accessToken}`);
    const rawSecret = setupRes.body.data.manual_entry_key;

    const validCode = generateTotpCode(rawSecret);
    const verifyRes = await request(app)
      .post('/api/v1/auth/mfa/totp/verify')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: validCode });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.backup_codes).toHaveLength(10);
    // All 10 codes must be genuinely distinct.
    expect(new Set(verifyRes.body.data.backup_codes).size).toBe(10);

    const user = await User.findOne({ email: 'mfa.test@example.com' });
    expect(user.mfa_enabled).toBe(true); // the critical integration write

    const config = await MFAConfiguration.findOne({ user_id: user._id });
    expect(config.enabled).toBe(true);
    expect(config.verified_at).not.toBeNull();

    const storedBackupCodes = await BackupCode.countDocuments({ mfa_config_id: config._id });
    expect(storedBackupCodes).toBe(10);
  });

  it('actually enforces MFA on the NEXT login attempt (end-to-end proof)', async () => {
    const accessToken = await createActiveUserAndLogin();
    const setupRes = await request(app)
      .post('/api/v1/auth/mfa/totp/setup')
      .set('Authorization', `Bearer ${accessToken}`);
    const validCode = generateTotpCode(setupRes.body.data.manual_entry_key);
    await request(app)
      .post('/api/v1/auth/mfa/totp/verify')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: validCode });

    const secondLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'mfa.test@example.com', password: PLAIN_PASSWORD });

    expect(secondLogin.status).toBe(200);
    expect(secondLogin.body.data.mfa_required).toBe(true);
    expect(secondLogin.body.data.mfa_method).toBe('TOTP');
  });
});

describe('POST /auth/mfa/totp/verify — error cases', () => {
  it('rejects an invalid code with 400 INVALID_CODE', async () => {
    const accessToken = await createActiveUserAndLogin();
    await request(app)
      .post('/api/v1/auth/mfa/totp/setup')
      .set('Authorization', `Bearer ${accessToken}`);

    const res = await request(app)
      .post('/api/v1/auth/mfa/totp/verify')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: '000000' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CODE');
  });

  it('rejects with 400 NO_PENDING_SETUP if verify is called without ever calling setup', async () => {
    const accessToken = await createActiveUserAndLogin();

    const res = await request(app)
      .post('/api/v1/auth/mfa/totp/verify')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: '123456' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_PENDING_SETUP');
  });

  it('rejects malformed codes (not exactly 6 digits) at the Zod layer, 400', async () => {
    const accessToken = await createActiveUserAndLogin();

    const res = await request(app)
      .post('/api/v1/auth/mfa/totp/verify')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: '12345' });

    expect(res.status).toBe(400);
  });
});
