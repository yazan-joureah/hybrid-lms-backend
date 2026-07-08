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

async function loginAndGetRefreshCookie() {
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

  const setCookieHeader = loginRes.headers['set-cookie'][0];
  const refreshCookie = setCookieHeader.split(';')[0]; // "refresh_token=<value>"
  return { refreshCookie, accessToken: loginRes.body.data.access_token };
}

describe('POST /auth/refresh — success path (Token Rotation)', () => {
  it('issues a new access_token and a NEW refresh_token cookie, revoking the old one', async () => {
    const { refreshCookie } = await loginAndGetRefreshCookie();
    const oldTokenCount = await RefreshToken.countDocuments({ revoked_at: null });
    expect(oldTokenCount).toBe(1);

    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', refreshCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.access_token).toBeTruthy();

    const newSetCookie = res.headers['set-cookie'][0];
    expect(newSetCookie).toMatch(/refresh_token=/);
    const newRefreshCookie = newSetCookie.split(';')[0];
    expect(newRefreshCookie).not.toBe(refreshCookie); // genuinely a DIFFERENT value — real rotation, not reuse

    const tokens = await RefreshToken.find({}).sort({ created_at: 1 });
    expect(tokens).toHaveLength(2);
    expect(tokens[0].revoked_at).not.toBeNull(); // the presented one is now revoked
    expect(tokens[1].revoked_at).toBeNull(); // the newly minted one is active
  });
});

describe('POST /auth/refresh — replay protection (rotation theft-detection)', () => {
  it('rejects a SECOND use of the same (already-rotated-away) refresh token', async () => {
    const { refreshCookie } = await loginAndGetRefreshCookie();

    const first = await request(app).post('/api/v1/auth/refresh').set('Cookie', refreshCookie);
    expect(first.status).toBe(200);

    // Attacker (or a buggy client) replays the ORIGINAL cookie, which the
    // server already revoked during the first refresh above.
    const replay = await request(app).post('/api/v1/auth/refresh').set('Cookie', refreshCookie);

    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('TOKEN_INVALID');
  });
});

describe('POST /auth/refresh — missing / malformed token', () => {
  it('returns 401 TOKEN_MISSING when no cookie is sent at all', async () => {
    const res = await request(app).post('/api/v1/auth/refresh');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_MISSING');
  });

  it('returns 401 TOKEN_INVALID for a well-formed but nonexistent token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', 'refresh_token=this-token-was-never-issued-by-us');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });
});

describe('POST /auth/refresh — FR-03b: Session Revocation after Password Reset', () => {
  it('returns 403 SESSION_REVOKED when User.token_version no longer matches the token', async () => {
    const { refreshCookie } = await loginAndGetRefreshCookie();

    // Simulate what POST /auth/reset-password will do once built: bump
    // token_version, instantly invalidating every RefreshToken minted
    // before this moment — WITHOUT touching the RefreshToken collection
    // at all. This is the entire point of the token_version design.
    await User.updateOne({ email: 'refresh.test@example.com' }, { $inc: { token_version: 1 } });

    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', refreshCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SESSION_REVOKED');
  });
});

describe('POST /auth/refresh — session already revoked via Logout', () => {
  it('returns 401 TOKEN_INVALID for a refresh token whose session was logged out', async () => {
    const { refreshCookie, accessToken } = await loginAndGetRefreshCookie();

    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(logoutRes.status).toBe(200);

    // logoutUser() already sets revoked_at on this exact RefreshToken row,
    // so this actually exercises the SAME guard as the replay-protection
    // test above — documented here for clarity, not a redundant test.
    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', refreshCookie);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });
});
