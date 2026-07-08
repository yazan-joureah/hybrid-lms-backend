const { calculateAge, isMinor } = require('../../src/utils/ageCalculator');

describe('calculateAge', () => {
  it('computes exact age when birthday already passed this year', () => {
    const ref = new Date('2026-07-03');
    expect(calculateAge('2000-01-15', ref)).toBe(26);
  });

  it('computes exact age when birthday has NOT occurred yet this year', () => {
    const ref = new Date('2026-07-03');
    expect(calculateAge('2000-12-25', ref)).toBe(25);
  });

  it('handles birthday exactly today', () => {
    const ref = new Date('2026-07-03');
    expect(calculateAge('2008-07-03', ref)).toBe(18);
  });
});

describe('isMinor', () => {
  it('returns true for a 17-year-old', () => {
    const ref = new Date('2026-07-03');
    expect(isMinor('2009-01-01', ref)).toBe(true);
  });

  it('returns false for an 18-year-old (boundary — turns 18 today)', () => {
    const ref = new Date('2026-07-03');
    expect(isMinor('2008-07-03', ref)).toBe(false);
  });

  it('returns false for a clearly adult user', () => {
    const ref = new Date('2026-07-03');
    expect(isMinor('1990-01-01', ref)).toBe(false);
  });
});
