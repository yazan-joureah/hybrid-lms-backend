/**
 * Integration test for POST /auth/verify-email (OTP-based, replaces the
 * former GET+query-token flow — see project decision log).
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const User = require('../../src/models/User');
const AuthToken = require('../../src/models/AuthToken');
const GuardianApproval = require('../../src/models/GuardianApproval');
const { generateNumericOtp } = require('../../src/utils/crypto');
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

async function createUserWithVerificationCode({
  minor = false,
  expiresInMinutes = 15,
  usedAt = null,
  attemptCount = 0,
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

  const { raw, hash } = generateNumericOtp();
  await AuthToken.create({
    user_id: user._id,
    token_hash: hash,
    token_type: 'EMAIL_VERIFICATION',
    expires_at: new Date(Date.now() + expiresInMinutes * 60 * 1000),
    used_at: usedAt,
    attempt_count: attemptCount,
  });

  return { user, code: raw };
}

describe('POST /auth/verify-email — adult path', () => {
  it('activates the account immediately and returns status=active', async () => {
    const { user, code } = await createUserWithVerificationCode({ minor: false });

    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: user.email, code });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('active');
    expect(res.body.data.next_step).toBe('login');

    const updated = await User.findById(user._id);
    expect(updated.status).toBe('active');
    expect(updated.email_verified_at).not.toBeNull();
  });
});

describe('POST /auth/verify-email — minor path, guardian NOT yet approved', () => {
  it('sets status=guardian_pending — the closed state-machine decision, not "active"', async () => {
    const { user, code } = await createUserWithVerificationCode({ minor: true });

    await GuardianApproval.create({
      user_id: user._id,
      guardian_email: 'guardian.verify@example.com',
      approval_token_hash: 'irrelevant-hash',
      student_access_token_hash: 'irrelevant-hash',
      status: 'pending',
      expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000),
      student_registration_ip: '127.0.0.1',
    });

    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: user.email, code });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('guardian_pending');
    expect(res.body.data.next_step).toBe('guardian_pending');

    const updated = await User.findById(user._id);
    expect(updated.status).toBe('guardian_pending');
    expect(updated.email_verified_at).not.toBeNull();
  });
});

describe('POST /auth/verify-email — minor path, guardian ALREADY approved', () => {
  it('activates the account once BOTH conditions of the state machine are satisfied', async () => {
    const { user, code } = await createUserWithVerificationCode({ minor: true });

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

    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: user.email, code });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('active');
  });
});

describe('POST /auth/verify-email — invalid / expired / already-used codes', () => {
  it('rejects a code that does not exist with 400 INVALID_CODE', async () => {
    const user = await User.create({
      full_name: 'No Code User',
      email: 'nocode@example.com',
      password_hash: 'irrelevant',
      birth_date: new Date('1995-01-01'),
      role: 'Student',
      status: 'pending_email_verification',
      privacy_consent: {
        policy_version: 'v1.0',
        accepted_at: new Date(),
        ip: '127.0.0.1',
        user_agent: 'jest',
      },
    });

    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: user.email, code: '000000' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CODE');
  });

  it('rejects an already-used code with 400 INVALID_CODE (unified — no distinct ALREADY_USED oracle)', async () => {
    const { user, code } = await createUserWithVerificationCode({ usedAt: new Date() });

    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: user.email, code });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CODE');
  });

  it('rejects an expired code with 400 CODE_EXPIRED', async () => {
    const { user, code } = await createUserWithVerificationCode({ expiresInMinutes: -1 });

    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: user.email, code });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CODE_EXPIRED');
  });

  it('enforces One-Time Use — a second verification with the SAME code fails', async () => {
    const { user, code } = await createUserWithVerificationCode({ minor: false });

    const first = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: user.email, code });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: user.email, code });
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('INVALID_CODE');
  });

  it('rejects malformed codes (not exactly 6 digits) at the Zod layer, 400', async () => {
    const { user } = await createUserWithVerificationCode();

    const res = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: user.email, code: '12345' });

    expect(res.status).toBe(400);
  });
});

describe('POST /auth/verify-email — attempt counter (SF-AUTH-02, MAX_OTP_ATTEMPTS=5)', () => {
  it('accumulates attempt_count on each wrong guess, and still accepts the correct code before the limit', async () => {
    const { user, code } = await createUserWithVerificationCode();

    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- sequential wrong guesses, small fixed count
      const wrong = await request(app)
        .post('/api/v1/auth/verify-email')
        .send({ email: user.email, code: '999999' });
      expect(wrong.status).toBe(400);
      expect(wrong.body.error.code).toBe('INVALID_CODE');
    }

    const stored = await AuthToken.findOne({ user_id: user._id, token_type: 'EMAIL_VERIFICATION' });
    expect(stored.attempt_count).toBe(3);

    const success = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: user.email, code });
    expect(success.status).toBe(200); // 4th attempt, still within the limit
  });

  it('permanently invalidates the code after the 5th wrong attempt, rejecting even the CORRECT code afterward', async () => {
    const { user, code } = await createUserWithVerificationCode();

    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await request(app)
        .post('/api/v1/auth/verify-email')
        .send({ email: user.email, code: '999999' });
    }

    const stored = await AuthToken.findOne({ user_id: user._id, token_type: 'EMAIL_VERIFICATION' });
    expect(stored.used_at).not.toBeNull(); // disabled as a side effect of hitting the cap

    const withCorrectCode = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: user.email, code });

    expect(withCorrectCode.status).toBe(400);
    expect(withCorrectCode.body.error.code).toBe('INVALID_CODE');
  });
});
