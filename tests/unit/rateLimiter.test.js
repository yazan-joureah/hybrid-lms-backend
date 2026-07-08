const { computeLockoutSeconds } = require('../../src/middleware/rateLimiter');

describe('computeLockoutSeconds — Android-style exponential backoff', () => {
  it('returns the base duration on the first violation', () => {
    expect(computeLockoutSeconds(1)).toBe(30);
  });

  it('doubles the duration on each subsequent violation', () => {
    expect(computeLockoutSeconds(2)).toBe(60);
    expect(computeLockoutSeconds(3)).toBe(120);
    expect(computeLockoutSeconds(4)).toBe(240);
  });

  it('never exceeds the configured maximum (30 minutes)', () => {
    expect(computeLockoutSeconds(10)).toBe(1800);
    expect(computeLockoutSeconds(50)).toBe(1800);
  });
});
