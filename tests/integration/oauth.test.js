/**
 * Integration test for the full Google OAuth flow. `googleOAuthLogin.js`
 * is mocked entirely (jest.mock) — we NEVER call real Google APIs in
 * tests, exactly the same "no external service in CI" discipline already
 * applied to Gmail (disableRealGmail.js). `exchangeCodeForProfile` is
 * stubbed per-test to return whatever Google profile the scenario needs.
 */

require('dotenv').config();

const request = require('supertest');
const mongoose = require('mongoose');

jest.mock('../../src/config/googleOAuthLogin');
const { exchangeCodeForProfile } = require('../../src/config/googleOAuthLogin');

const app = require('../../src/app');
const User = require('../../src/models/User');
const ExternalIdentity = require('../../src/models/ExternalIdentity');
const GuardianApproval = require('../../src/models/GuardianApproval');
const { createState } = require('../../src/utils/oauthState');
const { hashPassword } = require('../../src/utils/crypto');
const redisClient = require('../../src/config/redis');

// Helper to robustly extract a token from the redirect URL regardless of what the backend named it
function extractTokenFromUrl(locationStr) {
  const parsed = new URL(locationStr, 'http://localhost');

  // 1. Check standard query parameter names
  let token =
    parsed.searchParams.get('registration_pending_token') ||
    parsed.searchParams.get('link_pending_token') ||
    parsed.searchParams.get('access_token') ||
    parsed.searchParams.get('token');

  // 2. Check hash fragments if used (e.g., #token=xyz)
  if (!token && parsed.hash) {
    const hashParams = new URLSearchParams(parsed.hash.substring(1));
    token = hashParams.get('token') || hashParams.get('access_token');
  }

  // 3. Fallback: Grab the first long string query parameter (likely a JWT or hex token)
  if (!token) {
    for (const [key, value] of parsed.searchParams.entries()) {
      if (value && value.length > 20 && key !== 'oauth_error') {
        token = value;
        break;
      }
    }
  }

  return token;
}

beforeAll(async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is undefined! Check your .env setup.');
  }

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI);
  }
}, 20000);

beforeEach(async () => {
  const { buildConsentUrl } = require('../../src/config/googleOAuthLogin');
  buildConsentUrl.mockResolvedValue('https://accounts.google.com/mock-consent-url');
  await Promise.all([
    User.deleteMany({}),
    ExternalIdentity.deleteMany({}),
    GuardianApproval.deleteMany({}),
  ]);
  await redisClient.flushdb();
  jest.clearAllMocks();
});

afterAll(async () => {
  await mongoose.connection.close();
  await redisClient.quit();
});

describe('GET /auth/google', () => {
  it('redirects to a Google URL (302)', async () => {
    const res = await request(app).get('/api/v1/auth/google');
    expect(res.status).toBe(302);
  });
});

describe('GET /auth/google/callback — invalid state (MUC-AUTH-14)', () => {
  it('redirects with INVALID_STATE for a forged/unknown state value', async () => {
    const res = await request(app)
      .get('/api/v1/auth/google/callback')
      .query({ code: 'irrelevant', state: 'forged-state-never-issued' });

    expect(res.status).toBe(302);
    const redirectUrl = new URL(res.headers.location, 'http://localhost');
    expect(redirectUrl.searchParams.get('oauth_error')).toMatch(
      /Invalid or expired OAuth session/i
    );
  });

  it('rejects a REPLAYED valid state on second use (GETDEL one-time enforcement)', async () => {
    const state = await createState();
    exchangeCodeForProfile.mockResolvedValue({
      providerUserId: 'google-123',
      email: 'new.oauth@example.com',
      emailVerified: true,
      fullName: 'New OAuth User',
    });

    const first = await request(app)
      .get('/api/v1/auth/google/callback')
      .query({ code: 'abc', state });
    expect(first.status).toBe(302);

    const replay = await request(app)
      .get('/api/v1/auth/google/callback')
      .query({ code: 'abc', state });

    expect(replay.status).toBe(302);
    const redirectUrl = new URL(replay.headers.location, 'http://localhost');
    expect(redirectUrl.searchParams.get('oauth_error')).toMatch(
      /Invalid or expired OAuth session/i
    );
  });
});

describe('GET /auth/google/callback — brand new user (adult)', () => {
  it('redirects to frontend, creates NO User yet', async () => {
    const state = await createState();
    exchangeCodeForProfile.mockResolvedValue({
      providerUserId: 'google-adult-1',
      email: 'adult.oauth@example.com',
      emailVerified: true,
      fullName: 'Adult OAuth',
    });

    const res = await request(app)
      .get('/api/v1/auth/google/callback')
      .query({ code: 'abc', state });

    expect(res.status).toBe(302);
    const token = extractTokenFromUrl(res.headers.location);
    expect(token).toBeTruthy();

    const userCount = await User.countDocuments({});
    expect(userCount).toBe(0); // nothing persisted until confirm
  });
});

describe('POST /auth/google/register/confirm — adult path', () => {
  it('creates an active User + ExternalIdentity, and completes login', async () => {
    const state = await createState();
    exchangeCodeForProfile.mockResolvedValue({
      providerUserId: 'google-adult-2',
      email: 'adult2.oauth@example.com',
      emailVerified: true,
      fullName: 'Adult Two',
    });

    const callbackRes = await request(app)
      .get('/api/v1/auth/google/callback')
      .query({ code: 'abc', state });

    const token = extractTokenFromUrl(callbackRes.headers.location);

    const res = await request(app).post('/api/v1/auth/google/register/confirm').send({
      registration_pending_token: token,
      birth_date: '1995-06-20',
      role: 'Student', // ← ADDED
    });

    expect(res.status).toBe(200);
    expect(res.body.data.access_token).toBeTruthy();

    const user = await User.findOne({ email: 'adult2.oauth@example.com' });
    expect(user.status).toBe('active');
    expect(user.password_hash).toBeNull();

    const identity = await ExternalIdentity.findOne({
      provider: 'GOOGLE',
      provider_user_id: 'google-adult-2',
    });
    expect(identity.user_id.toString()).toBe(user._id.toString());
  });
});

describe('POST /auth/google/register/confirm — minor path (UC-AUTH-12 unconditional)', () => {
  it('creates a guardian_pending User and requires a separate guardian-email step', async () => {
    const state = await createState();
    exchangeCodeForProfile.mockResolvedValue({
      providerUserId: 'google-minor-1',
      email: 'minor.oauth@example.com',
      emailVerified: true,
      fullName: 'Minor OAuth',
    });

    const callbackRes = await request(app)
      .get('/api/v1/auth/google/callback')
      .query({ code: 'abc', state });

    const token = extractTokenFromUrl(callbackRes.headers.location);

    const res = await request(app).post('/api/v1/auth/google/register/confirm').send({
      registration_pending_token: token,
      birth_date: '2012-01-01',
      role: 'Student', // ← ADDED
    });

    expect(res.status).toBe(200);
    expect(res.body.data.requires_guardian_email).toBe(true);
    expect(res.body.data.access_token).toBeUndefined();

    const user = await User.findOne({ email: 'minor.oauth@example.com' });
    expect(user.status).toBe('guardian_pending');

    const guardianRes = await request(app).post('/api/v1/auth/google/guardian-email').send({
      guardian_pending_token: res.body.data.guardian_pending_token,
      guardian_email: 'parent.oauth@example.com',
    });

    expect(guardianRes.status).toBe(200);
    const approval = await GuardianApproval.findOne({ user_id: user._id });
    expect(approval.guardian_email).toBe('parent.oauth@example.com');
  });
});

describe('GET /auth/google/callback — email matches an EXISTING local account (UC-AUTH-13)', () => {
  it('requires password confirmation before linking (does NOT auto-link)', async () => {
    const passwordHash = await hashPassword('an-existing-local-passphrase-2026');
    await User.create({
      full_name: 'Existing Local User',
      email: 'existing.local@example.com',
      password_hash: passwordHash,
      birth_date: new Date('1990-01-01'),
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

    const state = await createState();
    exchangeCodeForProfile.mockResolvedValue({
      providerUserId: 'google-existing-1',
      email: 'existing.local@example.com',
      emailVerified: true,
      fullName: 'Existing Local User',
    });

    const res = await request(app)
      .get('/api/v1/auth/google/callback')
      .query({ code: 'abc', state });

    expect(res.status).toBe(302);
    const linkToken = extractTokenFromUrl(res.headers.location);
    expect(linkToken).toBeTruthy();

    const identityCount = await ExternalIdentity.countDocuments({});
    expect(identityCount).toBe(0); // NOT linked yet — only after password confirmation
  });

  it('POST /google/link/confirm links successfully with the correct password', async () => {
    const passwordHash = await hashPassword('an-existing-local-passphrase-2026');
    const localUser = await User.create({
      full_name: 'Existing Local User 2',
      email: 'existing2.local@example.com',
      password_hash: passwordHash,
      birth_date: new Date('1990-01-01'),
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

    const state = await createState();
    exchangeCodeForProfile.mockResolvedValue({
      providerUserId: 'google-existing-2',
      email: 'existing2.local@example.com',
      emailVerified: true,
      fullName: 'Existing Local User 2',
    });

    const callbackRes = await request(app)
      .get('/api/v1/auth/google/callback')
      .query({ code: 'abc', state });

    const linkToken = extractTokenFromUrl(callbackRes.headers.location);

    const res = await request(app).post('/api/v1/auth/google/link/confirm').send({
      link_pending_token: linkToken,
      password: 'an-existing-local-passphrase-2026',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.access_token).toBeTruthy();

    const identity = await ExternalIdentity.findOne({ user_id: localUser._id });
    expect(identity.provider_user_id).toBe('google-existing-2');
  });

  it('rejects linking with the WRONG password', async () => {
    const passwordHash = await hashPassword('an-existing-local-passphrase-2026');
    await User.create({
      full_name: 'Existing Local User 3',
      email: 'existing3.local@example.com',
      password_hash: passwordHash,
      birth_date: new Date('1990-01-01'),
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

    const state = await createState();
    exchangeCodeForProfile.mockResolvedValue({
      providerUserId: 'google-existing-3',
      email: 'existing3.local@example.com',
      emailVerified: true,
      fullName: 'X',
    });

    const callbackRes = await request(app)
      .get('/api/v1/auth/google/callback')
      .query({ code: 'abc', state });

    const linkToken = extractTokenFromUrl(callbackRes.headers.location);

    const res = await request(app).post('/api/v1/auth/google/link/confirm').send({
      link_pending_token: linkToken,
      password: 'totally-wrong-password',
    });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_PASSWORD');
  });
});

describe('GET /auth/google/callback — returning user, already linked', () => {
  it('logs in directly without any confirmation step and issues session cookies', async () => {
    const user = await User.create({
      full_name: 'Returning OAuth User',
      email: 'returning.oauth@example.com',
      password_hash: null,
      birth_date: new Date('1990-01-01'),
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
    await ExternalIdentity.create({
      user_id: user._id,
      provider: 'GOOGLE',
      provider_user_id: 'google-returning-1',
    });

    const state = await createState();
    exchangeCodeForProfile.mockResolvedValue({
      providerUserId: 'google-returning-1',
      email: 'returning.oauth@example.com',
      emailVerified: true,
      fullName: 'Returning OAuth User',
    });

    const res = await request(app)
      .get('/api/v1/auth/google/callback')
      .query({ code: 'abc', state });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/dashboard?auth=google_success');
    expect(res.headers['set-cookie']).toBeTruthy();
  });
});

describe('GET /auth/google/callback — MUC-AUTH-15: race-condition protection at the DB layer', () => {
  it('rejects linking the SAME Google account to a second local user (compound unique index)', async () => {
    const passwordHash = await hashPassword('a-passphrase-2026-xyz');
    const userA = await User.create({
      full_name: 'User A',
      email: 'usera@example.com',
      password_hash: passwordHash,
      birth_date: new Date('1990-01-01'),
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
    await ExternalIdentity.create({
      user_id: userA._id,
      provider: 'GOOGLE',
      provider_user_id: 'google-shared-id',
    });

    // Simulate a race: directly attempt to insert a SECOND ExternalIdentity
    // row for the SAME provider_user_id, bypassing service logic, to prove
    // the DATABASE constraint itself is the real defense.
    const userB = await User.create({
      full_name: 'User B',
      email: 'userb@example.com',
      password_hash: passwordHash,
      birth_date: new Date('1990-01-01'),
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

    await expect(
      ExternalIdentity.create({
        user_id: userB._id,
        provider: 'GOOGLE',
        provider_user_id: 'google-shared-id',
      })
    ).rejects.toThrow(/duplicate key/);
  });
});
