/**
 * Integration test for POST /auth/register — exercises the FULL vertical
 * slice against real MongoDB + Redis (via docker compose), end-to-end.
 *
 * Deliberate design choice: Gmail is NEVER contacted here. GMAIL_* env
 * vars are expected to be unset in the test environment, so
 * emailService.isGmailConfigured() returns false and every email falls
 * through to the console-log dev path (see emailService.js). This keeps
 * CI/local tests fast, free, deterministic, and — critically — incapable
 * of ever sending a real email by accident (principle #7/#8, and the
 * earlier CI/CD security discussion).
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const User = require('../../src/models/User');
const AuthToken = require('../../src/models/AuthToken');
const GuardianApproval = require('../../src/models/GuardianApproval');
const redisClient = require('../../src/config/redis');

const ADULT_PAYLOAD = {
  full_name: 'Test Adult User',
  email: 'adult.integration.test@example.com',
  // gitleaks:allow
  password: 'a-genuinely-long-passphrase-2026',
  birth_date: '1995-06-20',
  role: 'Student',
  privacy_consent_version: 'v1.0',
};

const MINOR_PAYLOAD = {
  full_name: 'Test Minor User',
  email: 'minor.integration.test@example.com',
  // gitleaks:allow
  password: 'another-long-passphrase-2026',
  birth_date: '2012-01-01', // < 18 as of 2026
  role: 'Student',
  privacy_consent_version: 'v1.0',
  guardian_email: 'guardian.integration.test@example.com',
};

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI);
  }
}, 20000); // مهلة أطول قليلاً لعملية الاتصال الأولى الحقيقية

beforeEach(async () => {
  // Isolation between tests: each test starts from a clean slate for BOTH
  // the data it created AND the rate-limiter counters it may have tripped.
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

describe('POST /auth/register — adult path', () => {
  it('returns 201 and creates a pending_email_verification user with an EMAIL_VERIFICATION token', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(ADULT_PAYLOAD);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.message).toMatch(/verification email sent/i);
    expect(res.body.data.requires_guardian_approval).toBeUndefined();

    const user = await User.findOne({ email: ADULT_PAYLOAD.email });
    expect(user).not.toBeNull();
    expect(user.status).toBe('pending_email_verification');
    expect(user.password_hash).not.toBe(ADULT_PAYLOAD.password); // never store plaintext

    const token = await AuthToken.findOne({ user_id: user._id, token_type: 'EMAIL_VERIFICATION' });
    expect(token).not.toBeNull();
    expect(token.used_at).toBeNull();
  });
});

describe('POST /auth/register — minor path (UC-AUTH-02 trigger)', () => {
  it('returns 201 with requires_guardian_approval and creates a GuardianApproval record', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(MINOR_PAYLOAD);

    expect(res.status).toBe(201);
    expect(res.body.data.requires_guardian_approval).toBe(true);

    const user = await User.findOne({ email: MINOR_PAYLOAD.email });
    const approval = await GuardianApproval.findOne({ user_id: user._id });

    expect(approval).not.toBeNull();
    expect(approval.guardian_email).toBe(MINOR_PAYLOAD.guardian_email);
    expect(approval.status).toBe('pending');
    expect(approval.approval_token_hash).toBeTruthy();
    expect(approval.student_access_token_hash).toBeTruthy();

    // Roughly 48h TTL — allow a small tolerance for test execution time.
    const hoursUntilExpiry = (approval.expires_at - Date.now()) / (1000 * 60 * 60);
    expect(hoursUntilExpiry).toBeGreaterThan(47.9);
    expect(hoursUntilExpiry).toBeLessThanOrEqual(48);
  });
});

describe('POST /auth/register — User Enumeration prevention (MUC-AUTH-04)', () => {
  it('returns the SAME success shape for an already-registered email, without creating a duplicate', async () => {
    await request(app).post('/api/v1/auth/register').send(ADULT_PAYLOAD);
    const secondAttempt = await request(app).post('/api/v1/auth/register').send(ADULT_PAYLOAD);

    expect(secondAttempt.status).toBe(201);
    expect(secondAttempt.body.success).toBe(true);
    expect(secondAttempt.body.data.message).toMatch(/verification email sent/i);

    const count = await User.countDocuments({ email: ADULT_PAYLOAD.email });
    expect(count).toBe(1); // no duplicate created
  });
});

describe('POST /auth/register — input validation (FR-31)', () => {
  it('rejects a password shorter than 15 characters with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...ADULT_PAYLOAD, email: 'weakpass@example.com', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /auth/register — Android-style rate limiting (NFR-03)', () => {
  it('locks out after exceeding maxAttempts and returns 429 with Retry-After', async () => {
    const spamEmail = 'rate.limit.target@example.com';

    // Fire one more request than the configured threshold (default: 5).
    let lastResponse;
    for (let i = 0; i < 6; i += 1) {
      lastResponse = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...ADULT_PAYLOAD, email: spamEmail });
    }

    expect(lastResponse.status).toBe(429);
    expect(lastResponse.body.error.code).toBe('RATE_LIMITED');
    expect(lastResponse.headers['retry-after']).toBeDefined();
    expect(Number(lastResponse.headers['retry-after'])).toBeGreaterThan(0);
  });
});
