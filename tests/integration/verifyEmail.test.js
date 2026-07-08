/**
 * Integration test for GET /auth/verify-email.
 *
 * Deliberate testing strategy: the raw verification token is NEVER
 * persisted anywhere (DP-08 — only its SHA-256 hash is stored), so it
 * only ever exists transiently inside the outbound email. Rather than
 * fragile console-log scraping of the dev-mode email fallback, we mint
 * our own token here using the SAME utility the real flow uses
 * (generateOpaqueToken), then insert the AuthToken record directly. This
 * exercises the exact verification logic in full isolation from the
 * registration flow, which is already covered separately in
 * register.test.js.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const User = require('../../src/models/User');
const AuthToken = require('../../src/models/AuthToken');
const GuardianApproval = require('../../src/models/GuardianApproval');
const { generateOpaqueToken } = require('../../src/utils/crypto');
const redisClient = require('../../src/config/redis');

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI);
  }
}, 20000);

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    AuthToken.deleteMany({}),
    GuardianApproval.deleteMany({}),
  ]);
  await redisClient.flushdb();
});

afterAll(async () => {
  await mongoose.connection.close();
  await redisClient.quit();
});

async function createUserWithVerificationToken({
  minor = false,
  expiresInHours = 24,
  usedAt = null,
} = {}) {
  const user = await User.create({
    full_name: minor ? 'Test Minor User' : 'Test Adult User',
    email: minor ? 'minor.verify@example.com' : 'adult.verify@example.com',
    password_hash: 'irrelevant-for-this-test',
    birth_date: minor ? new Date('2012-01-01') : new Date('1995-06-20'),
    role: 'Student',
    status: 'pending_email_verification',
    privacy_consent: {
      policy_version: 'v1.0',
      accepted_at: new Date(),
      ip: '127.0.0.1',
      user_agent: 'jest',
    },
  });

  const { raw, hash } = generateOpaqueToken();
  await AuthToken.create({
    user_id: user._id,
    token_hash: hash,
    token_type: 'EMAIL_VERIFICATION',
    expires_at: new Date(Date.now() + expiresInHours * 60 * 60 * 1000),
    used_at: usedAt,
  });

  return { user, rawToken: raw };
}

describe('GET /auth/verify-email — adult path', () => {
  it('activates the account immediately and returns status=active', async () => {
    const { user, rawToken } = await createUserWithVerificationToken({ minor: false });

    const res = await request(app).get('/api/v1/auth/verify-email').query({ token: rawToken });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('active');
    expect(res.body.data.next_step).toBe('login');

    const updated = await User.findById(user._id);
    expect(updated.status).toBe('active');
    expect(updated.email_verified_at).not.toBeNull();
  });
});

describe('GET /auth/verify-email — minor path, guardian NOT yet approved', () => {
  it('sets status=guardian_pending — the closed state-machine decision, not "active"', async () => {
    const { user, rawToken } = await createUserWithVerificationToken({ minor: true });

    await GuardianApproval.create({
      user_id: user._id,
      guardian_email: 'guardian.verify@example.com',
      approval_token_hash: 'irrelevant-hash',
      student_access_token_hash: 'irrelevant-hash',
      status: 'pending',
      expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000),
      student_registration_ip: '127.0.0.1',
    });

    const res = await request(app).get('/api/v1/auth/verify-email').query({ token: rawToken });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('guardian_pending');
    expect(res.body.data.next_step).toBe('guardian_pending');

    const updated = await User.findById(user._id);
    expect(updated.status).toBe('guardian_pending');
    expect(updated.email_verified_at).not.toBeNull(); // email itself IS verified — only guardian side is pending
  });
});

describe('GET /auth/verify-email — minor path, guardian ALREADY approved', () => {
  it('activates the account once BOTH conditions of the state machine are satisfied', async () => {
    const { user, rawToken } = await createUserWithVerificationToken({ minor: true });

    await GuardianApproval.create({
      user_id: user._id,
      guardian_email: 'guardian.verify@example.com',
      approval_token_hash: 'irrelevant-hash',
      student_access_token_hash: 'irrelevant-hash',
      status: 'approved',
      approved_at: new Date(),
      expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000),
      student_registration_ip: '127.0.0.1',
    });

    const res = await request(app).get('/api/v1/auth/verify-email').query({ token: rawToken });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('active');
  });
});

describe('GET /auth/verify-email — invalid / already-used / expired tokens', () => {
  it('rejects a token that does not exist with 400 TOKEN_INVALID', async () => {
    const res = await request(app)
      .get('/api/v1/auth/verify-email')
      .query({ token: 'not-a-real-token-at-all' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });

  it('rejects an already-used token with 400 TOKEN_ALREADY_USED', async () => {
    const { rawToken } = await createUserWithVerificationToken({ usedAt: new Date() });

    const res = await request(app).get('/api/v1/auth/verify-email').query({ token: rawToken });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TOKEN_ALREADY_USED');
  });

  it('rejects an expired token with 400 TOKEN_EXPIRED', async () => {
    const { rawToken } = await createUserWithVerificationToken({ expiresInHours: -1 });

    const res = await request(app).get('/api/v1/auth/verify-email').query({ token: rawToken });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('enforces One-Time Use — a second verification with the SAME raw token fails', async () => {
    const { rawToken } = await createUserWithVerificationToken({ minor: false });

    const first = await request(app).get('/api/v1/auth/verify-email').query({ token: rawToken });
    expect(first.status).toBe(200);

    const second = await request(app).get('/api/v1/auth/verify-email').query({ token: rawToken });
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('TOKEN_ALREADY_USED');
  });
});
