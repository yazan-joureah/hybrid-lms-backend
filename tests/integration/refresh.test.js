/**
 * Integration test for POST /auth/refresh.
 *
 * Testing strategy note: Supertest does not automatically persist cookies
 * between separate `request(app)` calls the way a real browser would —
 * each call is independent. So we manually extract the `Set-Cookie` header
 * from the Login response and pass it explicitly via `.set('Cookie', ...)`
 * on the follow-up Refresh request. This is deliberate and correct: it
 * forces the test to prove the cookie mechanism itself works end-to-end,
 * rather than relying on a test-helper client that would hide a real bug
 * in cookie attributes (as we already caught once with clearCookie()).
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const User = require('../../src/models/User');
const Session = require('../../src/models/Session');
const RefreshToken = require('../../src/models/RefreshToken');
const redisClient = require('../../src/config/redis');

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

function extractCookie(setCookieHeader, name) {
  const raw = setCookieHeader.find((c) => c.startsWith(`${name}=`));
  return { raw: raw.split(';')[0], value: raw.split(';')[0].split('=')[1] };
}

async function loginAndGetCookies() {
  const { hashPassword } = require('../../src/utils/crypto');
  const passwordHash = await hashPassword(PLAIN_PASSWORD);
  await User.create({
    full_name: 'Refresh Test User',
    email: 'refresh.test@example.com',
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
    .send({ email: 'refresh.test@example.com', password: PLAIN_PASSWORD });

  const refresh = extractCookie(loginRes.headers['set-cookie'], 'refresh_token');
  const csrf = extractCookie(loginRes.headers['set-cookie'], 'csrf_token');
  return { refresh, csrf, accessToken: loginRes.body.data.access_token };
}

/** Convenience wrapper: every real client always sends BOTH the cookie and the matching CSRF header together. */
function doRefresh(refresh, csrf) {
  return request(app)
    .post('/api/v1/auth/refresh')
    .set('Cookie', [refresh.raw, csrf.raw])
    .set('X-CSRF-Token', csrf.value);
}

describe('POST /auth/refresh — success path (Token Rotation)', () => {
  it('issues a new access_token and NEW refresh_token + csrf_token cookies, revoking the old refresh token', async () => {
    const { refresh, csrf } = await loginAndGetCookies();
    const oldTokenCount = await RefreshToken.countDocuments({ revoked_at: null });
    expect(oldTokenCount).toBe(1);

    const res = await doRefresh(refresh, csrf);

    expect(res.status).toBe(200);
    expect(res.body.data.access_token).toBeTruthy();

    const newRefresh = extractCookie(res.headers['set-cookie'], 'refresh_token');
    expect(newRefresh.value).not.toBe(refresh.value);

    const tokens = await RefreshToken.find({}).sort({ created_at: 1 });
    expect(tokens).toHaveLength(2);
    expect(tokens[0].revoked_at).not.toBeNull();
    expect(tokens[1].revoked_at).toBeNull();
  });
});

describe('POST /auth/refresh — replay protection (rotation theft-detection)', () => {
  it('rejects a SECOND use of the same (already-rotated-away) refresh token', async () => {
    const { refresh, csrf } = await loginAndGetCookies();

    const first = await doRefresh(refresh, csrf);
    expect(first.status).toBe(200);

    // Replay the ORIGINAL cookie+CSRF pair — both are stale now, but the
    // CSRF pair still matches each other, so this correctly reaches the
    // refresh-token logic (not blocked at the CSRF layer) and THAT is
    // what rejects it — proving the two defenses are independent layers.
    const replay = await doRefresh(refresh, csrf);

    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('TOKEN_INVALID');
  });
});

describe('POST /auth/refresh — missing / malformed token', () => {
  it('returns 403 CSRF_TOKEN_INVALID when no cookies are sent at all (CSRF layer catches it first)', async () => {
    const res = await request(app).post('/api/v1/auth/refresh');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_TOKEN_INVALID');
  });

  it('returns 401 TOKEN_INVALID for a well-formed but nonexistent refresh token, given a VALID matching CSRF pair', async () => {
    const { csrf } = await loginAndGetCookies();
    const fakeRefreshCookie = { raw: 'refresh_token=this-token-was-never-issued-by-us' };

    const res = await doRefresh(fakeRefreshCookie, csrf);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });
});

describe('POST /auth/refresh — FR-03b: Session Revocation after Password Reset', () => {
  it('returns 403 SESSION_REVOKED when User.token_version no longer matches the token', async () => {
    const { refresh, csrf } = await loginAndGetCookies();

    await User.updateOne({ email: 'refresh.test@example.com' }, { $inc: { token_version: 1 } });

    const res = await doRefresh(refresh, csrf);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SESSION_REVOKED');
  });
});

describe('POST /auth/refresh — session already revoked via Logout', () => {
  it('returns 401 TOKEN_INVALID for a refresh token whose session was logged out', async () => {
    const { refresh, csrf, accessToken } = await loginAndGetCookies();

    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(logoutRes.status).toBe(200);

    const res = await doRefresh(refresh, csrf);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });
});
