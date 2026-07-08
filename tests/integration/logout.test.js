/**
 * Integration test for POST /auth/logout, which also serves as the
 * integration test for authMiddleware.requireAuth itself (this is the
 * first — and currently only — protected route in the codebase).
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const User = require('../../src/models/User');
const Session = require('../../src/models/Session');
const RefreshToken = require('../../src/models/RefreshToken');
const { hashPassword } = require('../../src/utils/crypto');
const redisClient = require('../../src/config/redis');

// gitleaks:allow
const PLAIN_PASSWORD = 'a-genuinely-long-passphrase-2026';

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI);
  }
}, 20000);

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Session.deleteMany({}), RefreshToken.deleteMany({})]);
  await redisClient.flushdb();
});

afterAll(async () => {
  await mongoose.connection.close();
  await redisClient.quit();
});

async function loginAndGetAccessToken() {
  const passwordHash = await hashPassword(PLAIN_PASSWORD);
  await User.create({
    full_name: 'Logout Test User',
    email: 'logout.test@example.com',
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
    .send({ email: 'logout.test@example.com', password: PLAIN_PASSWORD });

  return loginRes.body.data.access_token;
}

describe('POST /auth/logout — success path', () => {
  it('revokes the Session and all its RefreshTokens, and clears the cookie', async () => {
    const accessToken = await loginAndGetAccessToken();
    const sessionBefore = await Session.findOne({});
    expect(sessionBefore.status).toBe('active');

    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.message).toMatch(/logged out/i);
    expect(res.headers['set-cookie'][0]).toMatch(/refresh_token=;/);

    const sessionAfter = await Session.findById(sessionBefore._id);
    expect(sessionAfter.status).toBe('revoked');

    const refreshToken = await RefreshToken.findOne({ session_id: sessionBefore._id });
    expect(refreshToken.revoked_at).not.toBeNull();
  });

  it('is idempotent — logging out twice with the same still-valid access token does not error', async () => {
    const accessToken = await loginAndGetAccessToken();

    const first = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);
    const second = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200); // documented trade-off: access token stays valid until its own expiry
  });
});

describe('POST /auth/logout — authMiddleware guard (requireAuth)', () => {
  it('rejects with 401 MISSING_TOKEN when no Authorization header is sent', async () => {
    const res = await request(app).post('/api/v1/auth/logout');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MISSING_TOKEN');
  });

  it('rejects with 401 TOKEN_INVALID for a malformed token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', 'Bearer not-a-real-jwt-at-all');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });

  it('rejects with 401 TOKEN_INVALID for a well-formed but wrong-secret token', async () => {
    const jwt = require('jsonwebtoken');
    const forgedToken = jwt.sign(
      { sub: 'fake', sid: 'fake', type: 'access' },
      'wrong-secret-entirely',
      {
        algorithm: 'HS256',
      }
    );

    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${forgedToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });
});
