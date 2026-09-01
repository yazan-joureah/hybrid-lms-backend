/**
 * Integration test for POST /auth/login.
 *
 * Testing strategy note: the network-level rate limiter (rateLimiter.js)
 * and the account-level lockout (User.failed_login_count) are BOTH set
 * to a threshold of 5, and are independent mechanisms with different
 * storage backends (Redis vs MongoDB).
 *
 * UPDATED (fix/AUTH-BE-15): the network-level limiter no longer counts
 * every request — it now only counts requests that recordFailure()
 * classifies as a genuine credential-guessing failure (see
 * login.controller.js). A successful login is NEVER charged against the
 * Redis budget (see "network-level rate limiter" describe block below,
 * which is the regression test for the exact UX problem this fix
 * addresses: repeated successful logins — e.g. switching roles during a
 * live demo — must never trip the lockout).
 *
 * Because both layers now key off "failed" outcomes and share the same
 * threshold (5), driving repeated real wrong-password HTTP requests
 * against the SAME real account will still eventually surface both
 * layers in sequence (account lock first, then the network lock on the
 * request after that — see the dedicated describe block below for the
 * exact sequence). To test each layer in true isolation:
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
const { resolveAxisConfig } = require('../../src/middleware/rateLimiter');

const PLAIN_PASSWORD = 'a-genuinely-long-passphrase-2026';

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI);
  }
  // Ensure Redis is connected (once)
  if (redisClient.status !== 'ready') {
    await redisClient.connect();
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
  // Redis is guaranteed to be ready from beforeAll
  await redisClient.flushdb();
});

afterAll(async () => {
  // Close Mongoose
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
  // Quit Redis gracefully
  try {
    if (redisClient.status === 'ready') {
      await redisClient.quit();
    } else {
      await redisClient.disconnect();
    }
  } catch (_) {
    // Ignore
  }
  // Close any server instance if started by the app
  if (app && typeof app.close === 'function') {
    await new Promise((resolve) => app.close(resolve));
  }
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
    expect(sessionCount).toBe(0);
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

    expect(lastResult.error).toBe('INVALID_CREDENTIALS');
    const user = await User.findOne({ email: 'login.test@example.com' });
    expect(user.status).toBe('temporary_locked');
    expect(user.lock_until).not.toBeNull();

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
    user.lock_until = new Date(Date.now() + 10 * 60 * 1000);
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
    user.lock_until = new Date(Date.now() - 60 * 1000);
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

describe('POST /auth/login — network-level rate limiter, decoupled from success (fix/AUTH-BE-15)', () => {
  it('never locks out a user who logs in successfully many times in a row — the core regression this fix targets (e.g. switching roles repeatedly during a live demo)', async () => {
    const user = await createActiveUser();

    // Get the identifier threshold for login (15 per hour)
    const idConfig = resolveAxisConfig('login', 'id');
    // Run more than the threshold to prove success doesn't count
    const loops = idConfig.maxAttempts + 3;

    const statuses = [];
    for (let i = 0; i < loops; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: PLAIN_PASSWORD });
      statuses.push(res.status);
    }

    expect(statuses).toEqual(new Array(loops).fill(200));

    // Direct proof at the storage layer: the hits key for the identifier axis must never have been created.
    const hits = await redisClient.get(`rl:hits:login:id:${user.email}`);
    expect(hits).toBeNull();
  });

  it('resets the hit counter on a genuine success, so earlier near-misses do not carry into the next window', async () => {
    const user = await createActiveUser();

    // 3 wrong-password attempts — comfortably under the threshold on its own
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'wrong-password-attempt' });
    }

    const hitsBeforeSuccess = await redisClient.get(`rl:hits:login:id:${user.email}`);
    expect(Number(hitsBeforeSuccess)).toBe(3);

    const successRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PLAIN_PASSWORD });
    expect(successRes.status).toBe(200);

    const hitsAfterSuccess = await redisClient.get(`rl:hits:login:id:${user.email}`);
    expect(hitsAfterSuccess).toBeNull();
  });

  it('still blocks with 429 after exceeding maxAttempts CONSECUTIVE FAILURES from the same IP...', async () => {
    const { maxAttempts } = resolveAxisConfig('login', 'ip'); // 20

    const statuses = [];
    // 1. Increase limit to maxAttempts + 2
    for (let i = 0; i < maxAttempts + 2; i += 1) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: `nonexistent.ratelimit.${i}@example.com`,
          password: 'irrelevant-wrong-password',
        });
      statuses.push(res.status);
    }

    // 2. The first maxAttempts + 1 requests pass checkLock and return 401
    expect(statuses.slice(0, maxAttempts + 1)).toEqual(new Array(maxAttempts + 1).fill(401));

    // 3. The (maxAttempts + 2)th request is rejected by checkLock (429)
    expect(statuses[maxAttempts + 1]).toBe(429);
  });

  it('sequences account-level lockout (Mongo) and network-level lockout (Redis) correctly against the SAME real account', async () => {
    const user = await createActiveUser();

    // 1. Switch to idConfig (15) instead of ipConfig (20)
    const idConfig = resolveAxisConfig('login', 'id');
    const totalAttempts = idConfig.maxAttempts + 2; // 17 attempts

    const statuses = [];
    for (let i = 0; i < totalAttempts; i += 1) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'wrong-password-attempt' });
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 5)).toEqual(new Array(5).fill(401));

    // 2. Attempts 6 to 16: Mongo lock active (423). The 16th attempt arms the Redis lock.
    for (let i = 5; i <= idConfig.maxAttempts; i += 1) {
      expect(statuses[i]).toBe(423);
    }

    // 3. The 17th attempt (index 16) is rejected by Redis checkLock (429)
    expect(statuses[idConfig.maxAttempts + 1]).toBe(429);

    const updatedUser = await User.findOne({ email: user.email });
    expect(updatedUser.status).toBe('temporary_locked');
  });
});
