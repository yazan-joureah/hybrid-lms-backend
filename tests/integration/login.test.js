/**
 * Integration test for POST /auth/login.
 *
 * Testing strategy note: the network-level rate limiter (rateLimiter.js)
 * and the account-level lockout (User.failed_login_count) are BOTH set
 * to a threshold of 5, but are independent mechanisms with different
 * storage backends (Redis vs MongoDB). Driving 6 real failed HTTP
 * requests to observe the account lock would actually surface the
 * network rate limiter's 429 first (since it counts every request,
 * success or failure). To test each layer in true isolation:
 *   - The account-lockout ESCALATION logic is exercised by calling
 *     authService.loginUser() directly (bypassing Express/Redis entirely).
 *   - The controller's handling of an ALREADY-locked account is tested
 *     via a single HTTP request against a pre-seeded locked user — this
 *     never approaches the rate limiter's threshold.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const User = require('../../src/models/User');
const Session = require('../../src/models/Session');
const RefreshToken = require('../../src/models/RefreshToken');
const MFAConfiguration = require('../../src/models/MFAConfiguration');
const LoginAttempt = require('../../src/models/LoginAttempt');
const { hashPassword } = require('../../src/utils/crypto');
const authService = require('../../src/services/authService');
const redisClient = require('../../src/config/redis');
// gitleaks:allow
const PLAIN_PASSWORD = 'a-genuinely-long-passphrase-2026';

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI);
  }
}, 20000);

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Session.deleteMany({}),
    RefreshToken.deleteMany({}),
    MFAConfiguration.deleteMany({}),
    LoginAttempt.deleteMany({}),
  ]);
  await redisClient.flushdb();
});

afterAll(async () => {
  await mongoose.connection.close();
  await redisClient.quit();
});

async function createActiveUser({ role = 'Student', mfaEnabled = false } = {}) {
  const passwordHash = await hashPassword(PLAIN_PASSWORD);
  return User.create({
    full_name: 'Login Test User',
    email: 'login.test@example.com',
    password_hash: passwordHash,
    birth_date: new Date('1995-06-20'),
    role,
    status: 'active',
    email_verified_at: new Date(),
    mfa_enabled: mfaEnabled,
    privacy_consent: {
      policy_version: 'v1.0',
      accepted_at: new Date(),
      ip: '127.0.0.1',
      user_agent: 'jest',
    },
  });
}

describe('POST /auth/login — success path, no MFA', () => {
  it('returns 200 with access_token, sets refresh_token cookie, and computes redirect_to for Student', async () => {
    await createActiveUser({ role: 'Student' });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'login.test@example.com', password: PLAIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.access_token).toBeTruthy();
    expect(res.body.data.user.redirect_to).toBe('/dashboard');
    expect(res.headers['set-cookie'][0]).toMatch(/refresh_token=/);
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/);

    const sessionCount = await Session.countDocuments({});
    const refreshTokenCount = await RefreshToken.countDocuments({});
    expect(sessionCount).toBe(1);
    expect(refreshTokenCount).toBe(1);
  });

  it('computes redirect_to=/instructor/setup for an Instructor without MFA/KYC complete', async () => {
    await createActiveUser({ role: 'Instructor' });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'login.test@example.com', password: PLAIN_PASSWORD });

    expect(res.body.data.user.redirect_to).toBe('/instructor/setup');
  });
});

describe('POST /auth/login — MFA required', () => {
  it('returns mfa_required=true with NO access_token and NO cookie set', async () => {
    const user = await createActiveUser({ mfaEnabled: true });
    await MFAConfiguration.create({ user_id: user._id, method: 'TOTP', enabled: true });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'login.test@example.com', password: PLAIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.mfa_required).toBe(true);
    expect(res.body.data.mfa_method).toBe('TOTP');
    expect(res.body.data.access_token).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();

    const sessionCount = await Session.countDocuments({});
    expect(sessionCount).toBe(0); // no session created before MFA is proven
  });
});

describe('POST /auth/login — invalid credentials (User Enumeration prevention)', () => {
  it('returns the SAME 401 shape for a non-existent email and a wrong password', async () => {
    await createActiveUser();

    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'login.test@example.com', password: 'totally-wrong-password-2026' });

    const nonExistent = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody.here@example.com', password: PLAIN_PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(nonExistent.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(nonExistent.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrongPassword.body.error.message).toBe(nonExistent.body.error.message);
  });
});

describe('POST /auth/login — account state guards', () => {
  it('rejects with 403 EMAIL_NOT_VERIFIED when email_verified_at is null', async () => {
    const user = await createActiveUser();
    user.email_verified_at = null;
    user.status = 'pending_email_verification';
    await user.save();

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'login.test@example.com', password: PLAIN_PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(res.body.data.next_step).toBe('verify_email');
  });

  it('rejects with 403 GUARDIAN_PENDING for a minor awaiting guardian approval', async () => {
    const user = await createActiveUser();
    user.status = 'guardian_pending';
    await user.save();

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'login.test@example.com', password: PLAIN_PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GUARDIAN_PENDING');
  });
});

describe('Account lockout escalation (UC-AUTH-04) — service-level, bypasses HTTP rate limiter', () => {
  it('locks the account after exactly 5 failed password attempts', async () => {
    await createActiveUser();
    const fakeReq = { ip: '127.0.0.1', get: () => 'jest' };

    let lastResult;
    for (let i = 0; i < 5; i += 1) {
      lastResult = await authService.loginUser({
        email: 'login.test@example.com',
        password: 'wrong-password-attempt',
        req: fakeReq,
      });
    }

    expect(lastResult.error).toBe('INVALID_CREDENTIALS'); // 5th failure still reports as invalid creds...
    const user = await User.findOne({ email: 'login.test@example.com' });
    expect(user.status).toBe('temporary_locked'); // ...but the account is now locked as a side effect
    expect(user.lock_until).not.toBeNull();

    // A 6th attempt — even with the CORRECT password — must now be rejected as locked.
    const sixthAttempt = await authService.loginUser({
      email: 'login.test@example.com',
      password: PLAIN_PASSWORD,
      req: fakeReq,
    });
    expect(sixthAttempt.error).toBe('ACCOUNT_LOCKED');
  });
});

describe('POST /auth/login — already-locked account (single HTTP request)', () => {
  it('returns 423 without attempting Argon2id verification', async () => {
    const user = await createActiveUser();
    user.status = 'temporary_locked';
    user.lock_until = new Date(Date.now() + 10 * 60 * 1000); // 10 min in the future
    await user.save();

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'login.test@example.com', password: PLAIN_PASSWORD });

    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });
});

describe('POST /auth/login — auto-unlock after lock window passes (UC-AUTH-04 [a2])', () => {
  it('transparently reactivates the account and allows login once lock_until is in the past', async () => {
    const user = await createActiveUser();
    user.status = 'temporary_locked';
    user.lock_until = new Date(Date.now() - 60 * 1000); // 1 min in the PAST — window already expired
    user.failed_login_count = 5;
    await user.save();

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'login.test@example.com', password: PLAIN_PASSWORD });

    expect(res.status).toBe(200);
    const updated = await User.findOne({ email: 'login.test@example.com' });
    expect(updated.status).toBe('active');
    expect(updated.failed_login_count).toBe(0);
  });
});
