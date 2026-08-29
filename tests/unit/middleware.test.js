// tests/unit/middleware.test.js
//
// Pure unit coverage for middleware not otherwise isolated: requireRole,
// requireVerifiedIdentity.middleware, attachUserIfPresent, and the full
// rateLimit() middleware (previously only computeLockoutSeconds was
// tested). requireCsrfToken is already exercised end-to-end by the
// existing csrf.test.js integration suite, so it's intentionally not
// duplicated here.

jest.mock('../../src/models/User');
const User = require('../../src/models/User');
const { requireRole } = require('../../src/middleware/requireRole');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('requireRole middleware', () => {
  afterEach(() => jest.clearAllMocks());

  it('401 when req.user is absent (auth must run first)', async () => {
    const middleware = requireRole(['Admin']);
    const req = { user: null };
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('403 when the fresh DB role is not in the allowed list', async () => {
    User.findById.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve({ role: 'Student' }) }),
    });
    const middleware = requireRole(['Admin', 'SuperAdmin']);
    const req = { user: { id: 'u1' } };
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('403 when the user no longer exists in the DB', async () => {
    User.findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(null) }) });
    const middleware = requireRole(['Admin']);
    const req = { user: { id: 'gone' } };
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('calls next() and attaches req.verifiedRole — proves role is re-fetched, never trusted from the token', async () => {
    User.findById.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve({ role: 'Admin' }) }),
    });
    const middleware = requireRole(['Admin']);
    const req = { user: { id: 'u1' } };
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.verifiedRole).toBe('Admin');
  });

  it('throws synchronously when constructed with an empty roles array (programmer error)', () => {
    expect(() => requireRole([])).toThrow();
  });

  it('throws when User.findById rejects (DB error)', async () => {
    User.findById.mockReturnValue({
      select: () => ({ lean: () => Promise.reject(new Error('DB unreachable')) }),
    });
    const middleware = requireRole(['Admin']);
    const req = { user: { id: 'u1' } };
    const res = mockRes();
    const next = jest.fn();

    await expect(middleware(req, res, next)).rejects.toThrow('DB unreachable');
    expect(res.status).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});

const requireVerifiedIdentity = require('../../src/middleware/requireVerifiedIdentity.middleware');
const { assertIdentityVerified } = requireVerifiedIdentity;

describe('requireVerifiedIdentity.middleware.js', () => {
  afterEach(() => jest.clearAllMocks());

  it('throws USER_NOT_FOUND (404) when the user does not exist', async () => {
    User.findById.mockReturnValue({ select: () => Promise.resolve(null) });
    await expect(assertIdentityVerified('gone')).rejects.toMatchObject({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
    });
  });

  it('throws KYC_NOT_VERIFIED (403) when kyc_status is not verified', async () => {
    User.findById.mockReturnValue({
      select: () => Promise.resolve({ kyc_status: 'review_pending', mfa_enabled: true }),
    });
    await expect(assertIdentityVerified('u1')).rejects.toMatchObject({
      statusCode: 403,
      code: 'KYC_NOT_VERIFIED',
    });
  });

  it('throws MFA_REQUIRED (403) when KYC is verified but MFA is off', async () => {
    User.findById.mockReturnValue({
      select: () => Promise.resolve({ kyc_status: 'verified', mfa_enabled: false }),
    });
    await expect(assertIdentityVerified('u1')).rejects.toMatchObject({
      statusCode: 403,
      code: 'MFA_REQUIRED',
    });
  });

  it('resolves with the user when both KYC and MFA are satisfied', async () => {
    const fakeUser = { kyc_status: 'verified', mfa_enabled: true };
    User.findById.mockReturnValue({ select: () => Promise.resolve(fakeUser) });
    await expect(assertIdentityVerified('u1')).resolves.toBe(fakeUser);
  });

  it('route wrapper calls next(error) instead of throwing, on failure', async () => {
    User.findById.mockReturnValue({ select: () => Promise.resolve(null) });
    const req = { user: { id: 'gone' } };
    const next = jest.fn();

    await requireVerifiedIdentity(req, {}, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'USER_NOT_FOUND' }));
  });

  it('route wrapper calls next(error) when User.findById rejects (DB error)', async () => {
    User.findById.mockReturnValue({ select: () => Promise.reject(new Error('DB down')) });
    const req = { user: { id: 'u1' } };
    const next = jest.fn();

    await requireVerifiedIdentity(req, {}, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

jest.mock('../../src/utils/jwt', () => ({
  verifyAccessToken: jest.fn(),
  JwtError: class JwtError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));
const { verifyAccessToken, JwtError } = require('../../src/utils/jwt');
const { attachUserIfPresent } = require('../../src/middleware/attachUserIfPresent');

describe('attachUserIfPresent middleware', () => {
  afterEach(() => jest.clearAllMocks());

  it('sets req.user=null and calls next() when no Bearer header is present (never blocks the route)', async () => {
    const req = { get: () => undefined };
    const next = jest.fn();
    await attachUserIfPresent(req, {}, next);
    expect(req.user).toBeNull();
    expect(next).toHaveBeenCalled();
  });

  it('sets req.user=null on an invalid token instead of rejecting the request', async () => {
    verifyAccessToken.mockImplementation(() => {
      throw new JwtError('INVALID', 'bad token');
    });
    const req = { get: () => 'Bearer bad-token' };
    const next = jest.fn();
    await attachUserIfPresent(req, {}, next);
    expect(req.user).toBeNull();
    expect(next).toHaveBeenCalled();
  });

  it('attaches req.user and req.verifiedRole for a valid token', async () => {
    verifyAccessToken.mockReturnValue({ sub: 'u1', sid: 's1' });
    User.findById.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve({ role: 'Student' }) }),
    });
    const req = { get: () => 'Bearer good-token' };
    const next = jest.fn();
    await attachUserIfPresent(req, {}, next);
    expect(req.user).toEqual({ id: 'u1', sessionId: 's1' });
    expect(req.verifiedRole).toBe('Student');
    expect(next).toHaveBeenCalled();
  });

  // CORRECTED: user not found → verifiedRole becomes null, not undefined
  it('sets req.user from token and verifiedRole to null when user no longer exists in DB', async () => {
    verifyAccessToken.mockReturnValue({ sub: 'u1', sid: 's1' });
    User.findById.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve(null) }),
    });
    const req = { get: () => 'Bearer good-token' };
    const next = jest.fn();
    await attachUserIfPresent(req, {}, next);
    expect(req.user).toEqual({ id: 'u1', sessionId: 's1' });
    expect(req.verifiedRole).toBeNull();
    expect(next).toHaveBeenCalled();
  });
});

jest.mock('../../src/config/redis', () => ({
  ttl: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
}));
const redisClient = require('../../src/config/redis');
const { rateLimit } = require('../../src/middleware/rateLimiter');

function mockReqRes() {
  const req = { ip: '1.2.3.4' };
  const res = { set: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  return { req, res, next };
}

describe('rateLimit() middleware — dual-axis IP + identifier', () => {
  afterEach(() => jest.clearAllMocks());

  it('allows the request through when under threshold on both axes', async () => {
    redisClient.ttl.mockResolvedValue(-2); // no active lock
    redisClient.incr.mockResolvedValue(1); // well under maxAttempts
    const { req, res, next } = mockReqRes();

    await rateLimit('test-action', () => 'id-1')(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects with 429 immediately when already inside an active lock (no re-counting)', async () => {
    redisClient.ttl.mockResolvedValue(42);
    const { req, res, next } = mockReqRes();

    await rateLimit('test-action', () => 'id-1')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.set).toHaveBeenCalledWith('Retry-After', '42');
    expect(next).not.toHaveBeenCalled();
    expect(redisClient.incr).not.toHaveBeenCalled();
  });

  it('activates a new lock once maxAttempts (5) is exceeded on an axis', async () => {
    redisClient.ttl.mockResolvedValue(-2);
    redisClient.incr.mockImplementation((key) => {
      if (key.startsWith('rl:violations:')) return Promise.resolve(1);
      if (key.includes(':ip:')) return Promise.resolve(6); // breaches maxAttempts=5
      return Promise.resolve(1); // id axis stays fine
    });
    redisClient.set.mockResolvedValue('OK');
    const { req, res, next } = mockReqRes();

    await rateLimit('test-action', () => 'id-1')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();
    expect(redisClient.set).toHaveBeenCalledWith(
      expect.stringContaining('rl:lock:test-action:ip:'),
      '1',
      'EX',
      expect.any(Number)
    );
  });

  it('fails open (calls next) if Redis throws — a single infra failure must not take down the route', async () => {
    redisClient.ttl.mockRejectedValue(new Error('Redis unreachable'));
    const { req, res, next } = mockReqRes();

    await rateLimit('test-action', () => 'id-1')(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('uses "anonymous" as the identifier when no extractor is provided', async () => {
    redisClient.ttl.mockResolvedValue(-2);
    redisClient.incr.mockResolvedValue(1);
    const { req, res, next } = mockReqRes();

    await rateLimit('test-action', null)(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(redisClient.incr).toHaveBeenCalledWith(expect.stringContaining(':id:anonymous'));
  });
});
