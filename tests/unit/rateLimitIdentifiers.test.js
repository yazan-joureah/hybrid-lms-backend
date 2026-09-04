// tests/unit/rateLimitIdentifiers.test.js
const {
  loginIdentifier,
  mfaLoginVerifyIdentifier,
  mfaTotpVerifyIdentifier,
} = require('../../src/utils/rateLimitIdentifiers');

describe('loginIdentifier', () => {
  it('يُعيد req.body.email عند وجوده', () => {
    expect(loginIdentifier({ body: { email: 'a@example.com' } })).toBe('a@example.com');
  });

  it('يُعيد "unknown" عند غياب body.email (فرع || السالب)', () => {
    expect(loginIdentifier({ body: {} })).toBe('unknown');
  });

  it('يُعيد "unknown" عند غياب body بالكامل (اختبار Optional Chaining)', () => {
    expect(loginIdentifier({})).toBe('unknown');
  });
});

describe('mfaLoginVerifyIdentifier', () => {
  it('يُعيد req.body.mfaTempToken عند وجوده', () => {
    expect(mfaLoginVerifyIdentifier({ body: { mfaTempToken: 'tok123' } })).toBe('tok123');
  });

  it('يُعيد "anonymous" عند غيابه (فرع || السالب)', () => {
    expect(mfaLoginVerifyIdentifier({ body: {} })).toBe('anonymous');
  });

  it('يُعيد "anonymous" عند غياب body بالكامل', () => {
    expect(mfaLoginVerifyIdentifier({})).toBe('anonymous');
  });
});

describe('mfaTotpVerifyIdentifier', () => {
  it('يُعيد req.user.id مباشرة (لا فروع شرطية هنا — يفترض requireAuth سبق تنفيذه)', () => {
    expect(mfaTotpVerifyIdentifier({ user: { id: 'user-42' } })).toBe('user-42');
  });
});
