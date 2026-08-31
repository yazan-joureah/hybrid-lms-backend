// tests/unit/authUtils.test.js
//
// Aggregated unit coverage for previously-untested infra utilities:
// jwt.js, totp.js, sessionCookies.util.js, objectId.util.js,
// auditService.js, oauthState.js.

// ===== Mock environment to avoid real secrets =====
jest.mock('../../src/config/env', () => ({
  nodeEnv: 'test',
  port: 3000,
  appUrl: 'http://localhost:3000',
  frontUrl: 'http://localhost:5173',
  mongoUri: 'mongodb://dummy',
  redisUrl: 'redis://dummy',
  jwt: {
    accessSecret: 'test-access-secret',
    accessExpires: '15m',
    refreshExpiresDays: 7,
  },
  argon2: {
    memoryKB: 65536,
    timeCost: 3,
    parallelism: 1,
  },
  gmail: {
    clientId: 'dummy',
    clientSecret: 'dummy',
    refreshToken: 'dummy',
    senderEmail: 'dummy@example.com',
  },
  privacyPolicyVersion: 'v1.0',
  rateLimit: {
    windowMs: 600000,
    maxAttempts: 5,
    baseLockoutSeconds: 30,
    maxLockoutSeconds: 1800,
    violationsTtlSeconds: 86400,
  },
  accountLockout: { durationMinutes: 15 },
  // ========== FIX: valid 32-byte hex key ==========
  encryption: {
    masterKeyHex: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  },
  googleOAuthLogin: { clientId: 'dummy', clientSecret: 'dummy', redirectUri: 'http://dummy' },
  stripe: { secretKey: 'dummy', webhookSecret: 'dummy' },
  payment: { currency: 'usd', refundWindowDays: 10 },
  certSigning: { privateKeyPem: 'dummy', publicKeyPem: 'dummy', keyVersion: 'v1' },
  openBadges: { issuerId: 'http://dummy', issuerName: 'Hybrid LMS', issuerLogoUrl: null },
}));
// ====================================================

const jwt = require('jsonwebtoken');
const env = require('../../src/config/env');
const {
  signAccessToken,
  signMfaTempToken,
  verifyAccessToken,
  verifyMfaTempToken,
  JwtError,
  signOAuthLinkPendingToken,
  verifyOAuthLinkPendingToken,
} = require('../../src/utils/jwt');

describe('jwt.js — type confusion guards', () => {
  it('signs and verifies a valid access token', () => {
    const token = signAccessToken({ userId: 'u1', sessionId: 's1' });
    const decoded = verifyAccessToken(token);
    expect(decoded.sub).toBe('u1');
    expect(decoded.sid).toBe('s1');
  });

  it('rejects an mfa_temp token presented as an access token', () => {
    const mfaToken = signMfaTempToken({ userId: 'u1' });
    expect(() => verifyAccessToken(mfaToken)).toThrow(JwtError);
  });

  it('rejects an access token presented as an mfa_temp token', () => {
    const accessToken = signAccessToken({ userId: 'u1', sessionId: 's1' });
    expect(() => verifyMfaTempToken(accessToken)).toThrow(JwtError);
  });

  it('rejects a token signed with the wrong secret', () => {
    const forged = jwt.sign({ sub: 'u1', sid: 's1', type: 'access' }, 'wrong-secret-entirely', {
      algorithm: 'HS256',
    });
    expect(() => verifyAccessToken(forged)).toThrow(JwtError);
  });

  it('rejects an alg:none forged token', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'u1', sid: 's1', type: 'access' })).toString(
      'base64url'
    );
    const forged = `${header}.${payload}.`;
    expect(() => verifyAccessToken(forged)).toThrow(JwtError);
  });

  it('marks an expired token distinctly as EXPIRED', () => {
    const expired = jwt.sign({ sub: 'u1', sid: 's1', type: 'access' }, env.jwt.accessSecret, {
      algorithm: 'HS256',
      expiresIn: -10,
    });
    try {
      verifyAccessToken(expired);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(JwtError);
      expect(err.code).toBe('EXPIRED');
    }
  });

  it('OAuth link-pending token round-trips and carries providerUserId', () => {
    const token = signOAuthLinkPendingToken({ email: 'a@example.com', providerUserId: 'g-123' });
    const decoded = verifyOAuthLinkPendingToken(token);
    expect(decoded.sub).toBe('a@example.com');
    expect(decoded.providerUserId).toBe('g-123');
  });
});

const {
  generateEncryptedTotpSecret,
  buildProvisioningUri,
  verifyTotpCode,
  generateTotpCode,
} = require('../../src/utils/totp');

describe('totp.js — RFC 6238 behavior', () => {
  it('a freshly generated secret produces a code that verifies against itself', async () => {
    const { rawSecret, encryptedSecret } = generateEncryptedTotpSecret();
    const code = generateTotpCode(rawSecret);
    const isValid = await verifyTotpCode(encryptedSecret, code);
    expect(isValid).toBe(true);
  });

  it('rejects a code that is not exactly 6 digits, without throwing', async () => {
    const { encryptedSecret } = generateEncryptedTotpSecret();
    const isValid = await verifyTotpCode(encryptedSecret, '12a456');
    expect(isValid).toBe(false);
  });

  it('rejects an arbitrary wrong 6-digit code', async () => {
    const { encryptedSecret } = generateEncryptedTotpSecret();
    const isValid = await verifyTotpCode(encryptedSecret, '000000');
    expect(isValid).toBe(false);
  });

  it('buildProvisioningUri embeds the issuer and email in an otpauth:// URI', () => {
    const uri = buildProvisioningUri('JBSWY3DPEHPK3PXP', 'user@example.com');
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('issuer=Hybrid%20LMS');
  });
});

const { toObjectId } = require('../../src/utils/objectId.util');
const { AppError } = require('../../src/middleware/errorHandler');

describe('objectId.util.js', () => {
  it('casts a valid 24-char hex string to an ObjectId', () => {
    const id = toObjectId('507f1f77bcf86cd799439011');
    expect(id.toString()).toBe('507f1f77bcf86cd799439011');
  });

  it('throws a clean 400 AppError for an invalid id, not a raw Mongoose CastError', () => {
    expect(() => toObjectId('not-an-id')).toThrow(AppError);
    try {
      toObjectId('not-an-id', 'userId');
    } catch (err) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('INVALID_ID');
    }
  });
});

const { issueSessionCookies, clearSessionCookies } = require('../../src/utils/sessionCookies.util');

function mockRes() {
  return { cookie: jest.fn(), clearCookie: jest.fn() };
}

describe('sessionCookies.util.js', () => {
  it('issues refresh_token as HttpOnly + Secure + SameSite=None (cross-origin deployment)', () => {
    const res = mockRes();
    issueSessionCookies(res, 'raw-refresh-token');

    expect(res.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'raw-refresh-token',
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'none' })
    );
    // csrf_token لم يعد يُصدَر — الحماية من CSRF انتقلت لآلية Origin-header
    // allow-listing (requireTrustedOrigin) — راجع توثيق csrfProtection.js
    expect(res.cookie).toHaveBeenCalledTimes(1);
  });

  it('clearSessionCookies clears refresh_token with matching attributes', () => {
    const res = mockRes();
    clearSessionCookies(res);
    expect(res.clearCookie).toHaveBeenCalledWith(
      'refresh_token',
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'none' })
    );
    expect(res.clearCookie).toHaveBeenCalledTimes(1);
  });
});

jest.mock('../../src/models/AuditLog');
const AuditLog = require('../../src/models/AuditLog');
const auditService = require('../../src/services/auditService');

describe('auditService.js — never crashes the caller', () => {
  afterEach(() => jest.clearAllMocks());

  it('calls AuditLog.create with the expected shape', async () => {
    AuditLog.create.mockResolvedValue({});
    await auditService.record({
      actorId: 'u1',
      actorRole: 'Student',
      action: 'TEST_ACTION',
      resourceType: 'user',
      resourceId: 'u1',
      req: { ip: '127.0.0.1', get: () => 'jest' },
    });
    expect(AuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'TEST_ACTION', actor_role: 'Student' })
    );
  });

  it('swallows a DB failure instead of throwing', async () => {
    AuditLog.create.mockRejectedValue(new Error('DB down'));
    await expect(
      auditService.record({
        actorRole: 'System',
        action: 'X',
        resourceType: 'user',
        resourceId: 'u1',
      })
    ).resolves.toBeUndefined();
  });
});

// ===== Redis mock with correct naming =====
const mockRedis = {
  set: jest.fn(),
  getdel: jest.fn(),
  flushdb: jest.fn(),
  quit: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  status: 'ready',
};

jest.mock('../../src/config/redis', () => mockRedis);
// =========================================

const { createState, consumeState } = require('../../src/utils/oauthState');

describe('oauthState.js — CSRF state, one-time use via GETDEL', () => {
  afterEach(() => jest.clearAllMocks());

  it('createState stores the state value with a 10-minute TTL', async () => {
    mockRedis.set.mockResolvedValue('OK');
    const state = await createState();
    expect(state).toBeTruthy();
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringContaining('oauth:state:'),
      '1',
      'EX',
      600
    );
  });

  it('consumeState returns true when the state existed (GETDEL hit)', async () => {
    mockRedis.getdel.mockResolvedValue('1');
    const result = await consumeState('some-state');
    expect(result).toBe(true);
  });

  it('consumeState returns false for a missing/already-consumed state', async () => {
    mockRedis.getdel.mockResolvedValue(null);
    const result = await consumeState('some-state');
    expect(result).toBe(false);
  });

  it('short-circuits to false for empty input, without calling Redis (defensive)', async () => {
    const result = await consumeState(undefined);
    expect(result).toBe(false);
    expect(mockRedis.getdel).not.toHaveBeenCalled();
  });
});
