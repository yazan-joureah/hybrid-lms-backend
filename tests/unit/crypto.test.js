const {
  hashPassword,
  verifyPassword,
  generateOpaqueToken,
  sha256,
} = require('../../src/utils/crypto');

describe('Argon2id password hashing', () => {
  it('produces a hash that verifies correctly against the original password', async () => {
    // gitleaks:allow
    const password = 'a-genuinely-long-passphrase-2026';
    const hash = await hashPassword(password);

    expect(hash).not.toBe(password);
    expect(hash.startsWith('$argon2id$')).toBe(true);

    const isValid = await verifyPassword(password, hash);
    expect(isValid).toBe(true);
  });

  it('rejects an incorrect password against a valid hash', async () => {
    const hash = await hashPassword('correct-horse-battery-staple-2026');
    const isValid = await verifyPassword('wrong-password-entirely-2026', hash);
    expect(isValid).toBe(false);
  });

  it('produces different hashes for the same password (random salt per call)', async () => {
    // gitleaks:allow
    const password = 'same-password-different-salt-2026';
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);
    expect(hash1).not.toBe(hash2);
  });
});

describe('generateOpaqueToken', () => {
  it('returns a raw token and its SHA-256 hash, and the hash matches sha256(raw)', () => {
    const { raw, hash } = generateOpaqueToken();
    expect(raw).toBeTruthy();
    expect(hash).toBe(sha256(raw));
  });

  it('never returns the raw value equal to its own hash', () => {
    const { raw, hash } = generateOpaqueToken();
    expect(raw).not.toBe(hash);
  });

  it('generates unique tokens across calls', () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a.raw).not.toBe(b.raw);
  });
});
