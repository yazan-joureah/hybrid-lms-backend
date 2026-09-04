// tests/unit/crypto.encryption.test.js
const VALID_KEY_HEX = 'ab'.repeat(32); // 32 بايت بالضبط — صالح لـ AES-256
const SHORT_KEY_HEX = 'ab'.repeat(16); // 16 بايت فقط — غير صالح عمداً

function loadCryptoWithKey(masterKeyHex) {
  jest.resetModules();
  jest.doMock('../../src/config/env', () => ({
    argon2: { memoryKB: 65536, timeCost: 3, parallelism: 1 },
    encryption: { masterKeyHex },
  }));
  // eslint-disable-next-line global-require
  return require('../../src/utils/crypto');
}

describe('crypto.js — AES-256-GCM (encryptSecret/decryptSecret)', () => {
  it('يفك تشفير النص الأصلي بنجاح بعد تشفيره بمفتاح صالح (round-trip)', () => {
    const crypto = loadCryptoWithKey(VALID_KEY_HEX);
    const encrypted = crypto.encryptSecret('my-totp-secret');
    expect(crypto.decryptSecret(encrypted)).toBe('my-totp-secret');
  });

  it('ينتج تشفيراً مختلفاً في كل مرة لنفس النص (IV عشوائي)', () => {
    const crypto = loadCryptoWithKey(VALID_KEY_HEX);
    const first = crypto.encryptSecret('same-plaintext');
    const second = crypto.encryptSecret('same-plaintext');
    expect(first).not.toBe(second);
  });

  it('يرمي خطأً واضحاً عند مفتاح تشفير غير 32 بايت (فرع getEncryptionKey)', () => {
    const crypto = loadCryptoWithKey(SHORT_KEY_HEX);
    expect(() => crypto.encryptSecret('x')).toThrow(/must decode to exactly 32 bytes/);
  });

  it('decryptSecret يرمي خطأً عند تلاعب بالنص المُشفَّر (auth tag mismatch — كشف العبث)', () => {
    const crypto = loadCryptoWithKey(VALID_KEY_HEX);
    const encrypted = crypto.encryptSecret('sensitive-data');
    const tampered = encrypted.slice(0, -4) + 'AAAA';
    expect(() => crypto.decryptSecret(tampered)).toThrow();
  });
});

describe('crypto.js — deriveUserKey / encryptForUser / decryptForUser', () => {
  it('يرمي خطأً عند userId فارغ أو null (فرع !userId)', () => {
    const crypto = loadCryptoWithKey(VALID_KEY_HEX);
    expect(() => crypto.deriveUserKey(null)).toThrow(/requires a non-empty userId/);
    expect(() => crypto.deriveUserKey('')).toThrow(/requires a non-empty userId/);
  });

  it('نفس userId ينتج نفس المفتاح المشتق دائماً (حتمية HKDF)', () => {
    const crypto = loadCryptoWithKey(VALID_KEY_HEX);
    const key1 = crypto.deriveUserKey('user-123');
    const key2 = crypto.deriveUserKey('user-123');
    expect(key1.equals(key2)).toBe(true);
  });

  it('userId مختلف ينتج مفتاحاً مختلفاً تماماً (عزل بيانات المستخدمين)', () => {
    const crypto = loadCryptoWithKey(VALID_KEY_HEX);
    const keyA = crypto.deriveUserKey('user-A');
    const keyB = crypto.deriveUserKey('user-B');
    expect(keyA.equals(keyB)).toBe(false);
  });

  it('purpose مختلف لنفس userId ينتج مفتاحاً مختلفاً (عزل الاستخدامات — kyc مقابل غيره)', () => {
    const crypto = loadCryptoWithKey(VALID_KEY_HEX);
    const keyKyc = crypto.deriveUserKey('user-1', 'kyc-document-key');
    const keyOther = crypto.deriveUserKey('user-1', 'other-purpose');
    expect(keyKyc.equals(keyOther)).toBe(false);
  });

  it('encryptForUser/decryptForUser: round-trip صحيح لنفس userId', () => {
    const crypto = loadCryptoWithKey(VALID_KEY_HEX);
    const plaintext = Buffer.from('محتوى سري', 'utf8');
    const encrypted = crypto.encryptForUser(plaintext, 'user-123');
    const decrypted = crypto.decryptForUser(encrypted, 'user-123');
    expect(decrypted.toString('utf8')).toBe('محتوى سري');
  });

  it('فك التشفير بـ userId مختلف عن userId التشفير يفشل (IDOR على مستوى المفتاح المشتق)', () => {
    const crypto = loadCryptoWithKey(VALID_KEY_HEX);
    const plaintext = Buffer.from('secret', 'utf8');
    const encrypted = crypto.encryptForUser(plaintext, 'owner-user');
    expect(() => crypto.decryptForUser(encrypted, 'different-user')).toThrow();
  });
});

describe('crypto.js — generateNumericOtp', () => {
  it('يُنتج رمزاً من 6 أرقام بالضبط، وhash مطابق لـ sha256(raw)', () => {
    const crypto = loadCryptoWithKey(VALID_KEY_HEX);
    const { raw, hash } = crypto.generateNumericOtp();
    expect(raw).toMatch(/^\d{6}$/);
    expect(hash).toBe(crypto.sha256(raw));
  });

  it('يُضيف أصفاراً بادئة (padStart) عند قيمة عشوائية صغيرة', () => {
    const nodeCrypto = require('crypto');
    const spy = jest.spyOn(nodeCrypto, 'randomInt').mockReturnValue(42);
    const crypto = loadCryptoWithKey(VALID_KEY_HEX);
    const { raw } = crypto.generateNumericOtp();
    expect(raw).toBe('000042');
    spy.mockRestore();
  });
});
