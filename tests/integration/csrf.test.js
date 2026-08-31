/**
 * Integration test for Origin-based CSRF protection on POST /auth/refresh
 * (requireTrustedOrigin) — replaces the old Double-Submit Cookie test.
 * See csrfProtection.js docstring for the full rationale.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const User = require('../../src/models/User');
const RefreshToken = require('../../src/models/RefreshToken');
const { hashPassword } = require('../../src/utils/crypto');
const redisClient = require('../../src/config/redis');

const PLAIN_PASSWORD = 'a-genuinely-long-passphrase-2026';
const TRUSTED_ORIGIN = 'http://localhost:5173'; // matches ALLOWED_ORIGINS in csrfProtection.js

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI);
  }
}, 20000);

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), RefreshToken.deleteMany({})]);
  await redisClient.flushdb();
});

afterAll(async () => {
  await mongoose.connection.close();
  await redisClient.quit();
});

function extractCookie(setCookieHeader, name) {
  const raw = setCookieHeader.find((c) => c.startsWith(`${name}=`));
  return { raw: raw.split(';')[0], value: raw.split(';')[0].split('=')[1] };
}

async function loginAndGetRefreshCookie() {
  const passwordHash = await hashPassword(PLAIN_PASSWORD);
  await User.create({
    full_name: 'CSRF Test User',
    email: 'csrf.test@example.com',
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

  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'csrf.test@example.com', password: PLAIN_PASSWORD });

  return extractCookie(res.headers['set-cookie'], 'refresh_token');
}

describe('POST /auth/login — cookie attributes (cross-origin deployment)', () => {
  it('sets refresh_token as HttpOnly + Secure + SameSite=None, and does NOT set a csrf_token cookie', async () => {
    const passwordHash = await hashPassword(PLAIN_PASSWORD);
    await User.create({
      full_name: 'CSRF Test User',
      email: 'csrf.test2@example.com',
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

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'csrf.test2@example.com', password: PLAIN_PASSWORD });

    const rawRefresh = res.headers['set-cookie'].find((c) => c.startsWith('refresh_token='));
    const rawCsrf = res.headers['set-cookie'].find((c) => c.startsWith('csrf_token='));

    expect(rawRefresh).toMatch(/HttpOnly/i);
    expect(rawRefresh).toMatch(/Secure/i);
    expect(rawRefresh).toMatch(/SameSite=None/i);
    expect(rawCsrf).toBeUndefined(); // csrf_token cookie no longer exists
  });
});

describe('POST /auth/refresh — Origin-header CSRF enforcement (requireTrustedOrigin)', () => {
  it('rejects with 403 CSRF_TOKEN_INVALID when neither Origin nor Referer headers are present', async () => {
    const refresh = await loginAndGetRefreshCookie();

    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', refresh.raw);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_TOKEN_INVALID');
  });

  it('rejects with 403 when Origin is present but not in the allow-list (forged cross-site request)', async () => {
    const refresh = await loginAndGetRefreshCookie();

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', refresh.raw)
      .set('Origin', 'https://evil-attacker.example.com');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CORS_NOT_ALLOWED');
  });

  it('succeeds with 200 when Origin matches the allow-list, and rotates the refresh token', async () => {
    const refresh = await loginAndGetRefreshCookie();

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', refresh.raw)
      .set('Origin', TRUSTED_ORIGIN);

    expect(res.status).toBe(200);

    const newRefresh = extractCookie(res.headers['set-cookie'], 'refresh_token');
    expect(newRefresh.value).not.toBe(refresh.value); // rotated, not reused
  });
});
