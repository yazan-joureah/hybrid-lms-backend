// tests/unit/csrfProtection.test.js
jest.mock('../../src/config/env', () => ({ appUrl: 'https://app.example.com' }));
jest.mock('../../src/utils/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));

function mockReqRes(headers) {
  const req = { get: (name) => headers[name.toLowerCase()], ip: '1.2.3.4' };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  return { req, res, next };
}

describe('requireTrustedOrigin — كل الفروع', () => {
  let requireTrustedOrigin;
  let logger;

  beforeEach(() => {
    jest.resetModules();
    delete process.env.DEMO_FRONTEND_ORIGIN;
    // eslint-disable-next-line global-require
    ({ requireTrustedOrigin } = require('../../src/middleware/csrfProtection'));
    // eslint-disable-next-line global-require
    logger = require('../../src/utils/logger');
  });

  it('يسمح بالطلب عندما يكون Origin موجوداً ومطابقاً للقائمة البيضاء', () => {
    const { req, res, next } = mockReqRes({ origin: 'https://app.example.com' });
    requireTrustedOrigin(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('يرفض الطلب بـ403 عندما يكون Origin غير مطابق للقائمة البيضاء', () => {
    const { req, res, next } = mockReqRes({ origin: 'https://evil.com' });
    requireTrustedOrigin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('يسقط على Referer عند غياب Origin (fallback) ويسمح بالطلب إن كان مطابقاً', () => {
    const { req, res, next } = mockReqRes({ referer: 'https://app.example.com/some/page' });
    requireTrustedOrigin(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('يرفض عندما Referer موجود لكن أصله (origin) غير مسموح', () => {
    const { req, res, next } = mockReqRes({ referer: 'https://evil.com/page' });
    requireTrustedOrigin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('يرفض عند غياب كل من Origin وReferer معاً (الحالة المشبوهة الافتراضية)', () => {
    const { req, res, next } = mockReqRes({});
    requireTrustedOrigin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('يتضمن DEMO_FRONTEND_ORIGIN ضمن القائمة البيضاء عند تعريفه في البيئة', () => {
    process.env.DEMO_FRONTEND_ORIGIN = 'https://staging.example.com';
    jest.resetModules();
    // eslint-disable-next-line global-require
    const mod = require('../../src/middleware/csrfProtection');
    expect(mod.ALLOWED_ORIGINS).toContain('https://staging.example.com');

    const { req, res, next } = mockReqRes({ origin: 'https://staging.example.com' });
    mod.requireTrustedOrigin(req, res, next);
    expect(next).toHaveBeenCalled();

    delete process.env.DEMO_FRONTEND_ORIGIN;
  });

  it('لا يوجد تكرار في ALLOWED_ORIGINS (فرع إزالة التكرار عبر Set)', () => {
    const { ALLOWED_ORIGINS } = require('../../src/middleware/csrfProtection');
    expect(ALLOWED_ORIGINS.length).toBe(new Set(ALLOWED_ORIGINS).size);
  });
});
