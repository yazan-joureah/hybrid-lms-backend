/**
 * Integration test for the Double-Submit Cookie CSRF protection on
 * POST /auth/refresh — the only endpoint in this module that
 * authenticates via cookie alone (see csrfProtection.js docstring for
 * why every other route is exempt).
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const User = require('../../src/models/User');
const RefreshToken = require('../../src/models/RefreshToken');
const { hashPassword } = require('../../src/utils/crypto');
const redisClient = require('../../src/config/redis');

const PLAIN_PASSWORD = 'a-genuinely-long-passphrase-2026';

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

async function loginAndGetCookies() {
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

  const refresh = extractCookie(res.headers['set-cookie'], 'refresh_token');
  const csrf = extractCookie(res.headers['set-cookie'], 'csrf_token');
  return { refresh, csrf };
}

describe('POST /auth/login — issues a readable (non-HttpOnly) CSRF cookie', () => {
  it('sets csrf_token WITHOUT the HttpOnly flag, unlike refresh_token', async () => {
    const { refresh, csrf } = await loginAndGetCookies();

    expect(csrf.value).toBeTruthy();
    // Find the FULL raw Set-Cookie strings again to inspect flags precisely.
    const passwordUser = await User.findOne({ email: 'csrf.test@example.com' });
    expect(passwordUser).not.toBeNull();

    // Re-login to inspect raw headers directly (avoids re-deriving from extractCookie's trimmed form).
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'csrf.test@example.com', password: PLAIN_PASSWORD });
    const rawCsrf = res.headers['set-cookie'].find((c) => c.startsWith('csrf_token='));
    const rawRefresh = res.headers['set-cookie'].find((c) => c.startsWith('refresh_token='));

    expect(rawCsrf).not.toMatch(/HttpOnly/i);
    expect(rawRefresh).toMatch(/HttpOnly/i);
    expect(refresh.value).toBeTruthy();
  });
});

describe('POST /auth/refresh — CSRF enforcement', () => {
  it('rejects with 403 CSRF_TOKEN_INVALID when the X-CSRF-Token header is missing entirely', async () => {
    const { refresh } = await loginAndGetCookies();

    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', refresh.raw);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_TOKEN_INVALID');
  });

  it('rejects with 403 when the header value does NOT match the cookie (forged/guessed value)', async () => {
    const { refresh, csrf } = await loginAndGetCookies();

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', [refresh.raw, csrf.raw])
      .set('X-CSRF-Token', 'a-completely-different-forged-value');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_TOKEN_INVALID');
  });

  it('succeeds with 200 when cookie and header match exactly, and rotates the CSRF token', async () => {
    const { refresh, csrf } = await loginAndGetCookies();

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', [refresh.raw, csrf.raw])
      .set('X-CSRF-Token', csrf.value);

    expect(res.status).toBe(200);

    const newCsrf = extractCookie(res.headers['set-cookie'], 'csrf_token');
    expect(newCsrf.value).not.toBe(csrf.value); // rotated, not reused
  });
});
