/**
 * Integration test for POST /auth/forgot-password + POST /auth/reset-password
 * (OTP-based, replaces the former token-in-URL flow).
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const User = require('../../src/models/User');
const AuthToken = require('../../src/models/AuthToken');
const RefreshToken = require('../../src/models/RefreshToken');
const emailService = require('../../src/services/emailService');
const { hashPassword, generateNumericOtp } = require('../../src/utils/crypto');
const redisClient = require('../../src/config/redis');
// gitleaks:allow
const OLD_PASSWORD = 'a-genuinely-long-passphrase-2026';
const NEW_PASSWORD = 'a-brand-new-passphrase-after-reset-2026';

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI);
  }
}, 20000);

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), AuthToken.deleteMany({}), RefreshToken.deleteMany({})]);
  await redisClient.flushdb();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await mongoose.connection.close();
  await redisClient.quit();
});

async function createActiveUser(email = 'forgot.test@example.com') {
  const passwordHash = await hashPassword(OLD_PASSWORD);
  return User.create({
    full_name: 'Forgot Password Test User',
    email,
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
}

describe('POST /auth/forgot-password', () => {
  it('returns the generic success message and creates a PASSWORD_RESET AuthToken for an existing email', async () => {
    const user = await createActiveUser();
    const spy = jest.spyOn(emailService, 'sendPasswordResetEmail');

    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email });

    expect(res.status).toBe(200);
    expect(res.body.data.message).toMatch(/if this email exists/i);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toMatch(/^\d{6}$/);

    const token = await AuthToken.findOne({ user_id: user._id, token_type: 'PASSWORD_RESET' });
    expect(token).not.toBeNull();
    expect(token.used_at).toBeNull();
    expect(token.attempt_count).toBe(0);
  });

  it('returns the SAME 200 message for a non-existent email (User Enumeration prevention)', async () => {
    const existing = await createActiveUser();
    const forExisting = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: existing.email });
    const forNonExistent = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody.registered@example.com' });

    expect(forExisting.status).toBe(200);
    expect(forNonExistent.status).toBe(200);
    expect(forExisting.body.data.message).toBe(forNonExistent.body.data.message);
  });

  it('invalidates a previous still-valid reset code when requested twice (SF-AUTH-05)', async () => {
    const user = await createActiveUser();

    await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email });
    const firstToken = await AuthToken.findOne({ user_id: user._id, token_type: 'PASSWORD_RESET' });

    await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email });
    const stillThere = await AuthToken.findById(firstToken._id);

    expect(stillThere).toBeNull();
    const activeTokens = await AuthToken.countDocuments({
      user_id: user._id,
      token_type: 'PASSWORD_RESET',
    });
    expect(activeTokens).toBe(1);
  });
});

describe('POST /auth/reset-password — error cases', () => {
  it('rejects a code that does not exist with 400 INVALID_CODE', async () => {
    const user = await createActiveUser();

    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: user.email, code: '000000', new_password: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CODE');
  });

  it('rejects an already-used code with 400 INVALID_CODE', async () => {
    const user = await createActiveUser();
    const { raw, hash } = generateNumericOtp();
    await AuthToken.create({
      user_id: user._id,
      token_hash: hash,
      token_type: 'PASSWORD_RESET',
      expires_at: new Date(Date.now() + 15 * 60 * 1000),
      used_at: new Date(),
    });

    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: user.email, code: raw, new_password: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CODE');
  });

  it('rejects an expired code with 400 CODE_EXPIRED', async () => {
    const user = await createActiveUser();
    const { raw, hash } = generateNumericOtp();
    await AuthToken.create({
      user_id: user._id,
      token_hash: hash,
      token_type: 'PASSWORD_RESET',
      expires_at: new Date(Date.now() - 60 * 1000),
    });

    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: user.email, code: raw, new_password: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CODE_EXPIRED');
  });

  it('rejects a weak new_password with 400 before ever touching the code (Zod-level)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: 'irrelevant@example.com', code: '123456', new_password: 'short' });

    expect(res.status).toBe(400);
  });

  it('locks the code out after 5 wrong attempts (TOO_MANY_ATTEMPTS), rejecting even the correct code afterward', async () => {
    const user = await createActiveUser();
    const { raw, hash } = generateNumericOtp();
    await AuthToken.create({
      user_id: user._id,
      token_hash: hash,
      token_type: 'PASSWORD_RESET',
      expires_at: new Date(Date.now() + 15 * 60 * 1000),
    });

    // 5 wrong attempts
    let fifthAttemptResponse;
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const response = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ email: user.email, code: '999999', new_password: NEW_PASSWORD });
      if (i === 4) fifthAttemptResponse = response;
    }

    // The 5th wrong attempt should return 429 and TOO_MANY_ATTEMPTS
    expect(fifthAttemptResponse.status).toBe(429);
    expect(fifthAttemptResponse.body.error.code).toBe('TOO_MANY_ATTEMPTS');

    // Now the correct code should be rejected with 400 INVALID_CODE (token is used_at)
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: user.email, code: raw, new_password: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CODE');

    const stillOldPassword = await User.findOne({ email: user.email });
    const stillWorks = require('../../src/utils/crypto').verifyPassword;
    expect(await stillWorks(OLD_PASSWORD, stillOldPassword.password_hash)).toBe(true);
  });
});

describe('CAPSTONE — full lifecycle: Login → Forgot → Reset → old session dead → new credentials work', () => {
  it('proves FR-03b and Token Rotation compose correctly across the whole AUTH module', async () => {
    const user = await createActiveUser();

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: OLD_PASSWORD });
    expect(loginRes.status).toBe(200);

    const oldRefreshCookie = loginRes.headers['set-cookie']
      .find((c) => c.startsWith('refresh_token='))
      .split(';')[0];
    const oldCsrfCookie = loginRes.headers['set-cookie']
      .find((c) => c.startsWith('csrf_token='))
      .split(';')[0];
    const oldCsrfValue = oldCsrfCookie.split('=')[1];

    const sessionsBeforeReset = await RefreshToken.countDocuments({
      user_id: user._id,
      revoked_at: null,
    });
    expect(sessionsBeforeReset).toBe(1);

    const spy = jest.spyOn(emailService, 'sendPasswordResetEmail');
    const forgotRes = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: user.email });
    expect(forgotRes.status).toBe(200);
    const resetCode = spy.mock.calls[0][1];

    const resetRes = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: user.email, code: resetCode, new_password: NEW_PASSWORD });
    expect(resetRes.status).toBe(200);

    const userAfterReset = await User.findById(user._id);
    expect(userAfterReset.token_version).toBe(2);

    const refreshWithOldCookie = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', [oldRefreshCookie, oldCsrfCookie])
      .set('X-CSRF-Token', oldCsrfValue);

    expect(refreshWithOldCookie.status).toBe(401);
    expect(refreshWithOldCookie.body.error.code).toBe('TOKEN_INVALID');

    const loginWithOldPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: OLD_PASSWORD });
    expect(loginWithOldPassword.status).toBe(401);
    expect(loginWithOldPassword.body.error.code).toBe('INVALID_CREDENTIALS');

    const loginWithNewPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: NEW_PASSWORD });
    expect(loginWithNewPassword.status).toBe(200);
    expect(loginWithNewPassword.body.data.access_token).toBeTruthy();

    const activeRefreshTokensNow = await RefreshToken.countDocuments({
      user_id: user._id,
      revoked_at: null,
    });
    expect(activeRefreshTokensNow).toBe(1);
  });
});
