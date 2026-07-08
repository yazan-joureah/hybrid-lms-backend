/**
 * Integration test for POST /auth/forgot-password + POST /auth/reset-password.
 *
 * This is the CAPSTONE test for the entire AUTH module: it exercises the
 * full realistic lifecycle (Login → Forgot Password → Reset Password →
 * old session rejected → new credentials work) across FOUR previously
 * separate features (login, forgot/reset, refresh's token_version check,
 * logout's revocation pattern), proving they compose correctly as one
 * system rather than as isolated, individually-passing units.
 *
 * Token retrieval strategy: unlike Postman (pure black-box HTTP), Jest has
 * white-box access to the module graph. We spy on
 * emailService.sendPasswordResetEmail to capture the exact resetUrl the
 * service would have emailed, then extract the raw token from it — this
 * avoids console-log scraping while still exercising the REAL
 * forgotPassword() code path end-to-end, including the real email-service
 * call (which safely no-ops to dev-mode logging, per emailService.js).
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const User = require('../../src/models/User');
const AuthToken = require('../../src/models/AuthToken');
const RefreshToken = require('../../src/models/RefreshToken');
const emailService = require('../../src/services/emailService');
const { hashPassword, generateOpaqueToken } = require('../../src/utils/crypto');
const redisClient = require('../../src/config/redis');

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

function extractTokenFromUrl(url) {
  return new URL(url).searchParams.get('token');
}

describe('POST /auth/forgot-password', () => {
  it('returns the generic success message and creates a PASSWORD_RESET AuthToken for an existing email', async () => {
    const user = await createActiveUser();
    const spy = jest.spyOn(emailService, 'sendPasswordResetEmail');

    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email });

    expect(res.status).toBe(200);
    expect(res.body.data.message).toMatch(/if this email exists/i);
    expect(spy).toHaveBeenCalledTimes(1);

    const token = await AuthToken.findOne({ user_id: user._id, token_type: 'PASSWORD_RESET' });
    expect(token).not.toBeNull();
    expect(token.used_at).toBeNull();
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

  it('invalidates a previous still-valid reset token when requested twice (SF-AUTH-05)', async () => {
    const user = await createActiveUser();

    await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email });
    const firstToken = await AuthToken.findOne({ user_id: user._id, token_type: 'PASSWORD_RESET' });

    await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email });
    const stillThere = await AuthToken.findById(firstToken._id);

    expect(stillThere).toBeNull(); // SF-AUTH-05 deleted it atomically before issuing the new one
    const activeTokens = await AuthToken.countDocuments({
      user_id: user._id,
      token_type: 'PASSWORD_RESET',
    });
    expect(activeTokens).toBe(1); // exactly one — the new one
  });
});

describe('POST /auth/reset-password — token error cases', () => {
  it('rejects an invalid token with 400 TOKEN_INVALID', async () => {
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'this-token-does-not-exist', new_password: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });

  it('rejects an already-used token with 400 TOKEN_ALREADY_USED', async () => {
    const user = await createActiveUser();
    const { raw, hash } = generateOpaqueToken();
    await AuthToken.create({
      user_id: user._id,
      token_hash: hash,
      token_type: 'PASSWORD_RESET',
      expires_at: new Date(Date.now() + 15 * 60 * 1000),
      used_at: new Date(),
    });

    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: raw, new_password: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TOKEN_ALREADY_USED');
  });

  it('rejects an expired token with 400 TOKEN_EXPIRED', async () => {
    const user = await createActiveUser();
    const { raw, hash } = generateOpaqueToken();
    await AuthToken.create({
      user_id: user._id,
      token_hash: hash,
      token_type: 'PASSWORD_RESET',
      expires_at: new Date(Date.now() - 60 * 1000),
    });

    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: raw, new_password: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rejects a weak new_password with 400 before ever touching the token (Zod-level)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'irrelevant-fails-validation-first', new_password: 'short' });

    expect(res.status).toBe(400);
  });
});

describe('CAPSTONE — full lifecycle: Login → Forgot → Reset → old session dead → new credentials work', () => {
  it('proves FR-03b and Token Rotation compose correctly across the whole AUTH module', async () => {
    const user = await createActiveUser();

    // 1) Log in with the OLD password — establish a real session + refresh cookie.
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: OLD_PASSWORD });
    expect(loginRes.status).toBe(200);
    const oldRefreshCookie = loginRes.headers['set-cookie'][0].split(';')[0];

    const sessionsBeforeReset = await RefreshToken.countDocuments({
      user_id: user._id,
      revoked_at: null,
    });
    expect(sessionsBeforeReset).toBe(1);

    // 2) Request a password reset — capture the real token via the spy.
    const spy = jest.spyOn(emailService, 'sendPasswordResetEmail');
    const forgotRes = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: user.email });
    expect(forgotRes.status).toBe(200);
    const rawResetToken = extractTokenFromUrl(spy.mock.calls[0][1]);

    // 3) Actually reset the password.
    const resetRes = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: rawResetToken, new_password: NEW_PASSWORD });
    expect(resetRes.status).toBe(200);
    expect(resetRes.body.data.message).toMatch(/all sessions have been terminated/i);

    const userAfterReset = await User.findById(user._id);
    expect(userAfterReset.token_version).toBe(2); // incremented from the default 1 — FR-03b in action

    // 4) The OLD refresh cookie (from step 1, minted BEFORE the reset) must
    // now be rejected. It hits TOKEN_INVALID specifically (not
    // SESSION_REVOKED) because resetPassword() ALSO explicitly revoked
    // every RefreshToken row as an immediate storage cleanup — the
    // token_version mechanism itself was already proven independently in
    // refresh.test.js's dedicated FR-03b test. Both defenses firing here
    // together is correct, layered behavior, not a contradiction.
    const refreshWithOldCookie = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', oldRefreshCookie);
    expect(refreshWithOldCookie.status).toBe(401);
    expect(refreshWithOldCookie.body.error.code).toBe('TOKEN_INVALID');

    // 5) The OLD password must no longer work at all.
    const loginWithOldPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: OLD_PASSWORD });
    expect(loginWithOldPassword.status).toBe(401);
    expect(loginWithOldPassword.body.error.code).toBe('INVALID_CREDENTIALS');

    // 6) The NEW password must work and establish a genuinely fresh session.
    const loginWithNewPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: NEW_PASSWORD });
    expect(loginWithNewPassword.status).toBe(200);
    expect(loginWithNewPassword.body.data.access_token).toBeTruthy();

    const activeRefreshTokensNow = await RefreshToken.countDocuments({
      user_id: user._id,
      revoked_at: null,
    });
    expect(activeRefreshTokensNow).toBe(1); // exactly the brand-new one from step 6
  });
});
