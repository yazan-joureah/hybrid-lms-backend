const { registerSchema } = require('../../src/validators/authSchemas');

const validAdultPayload = {
  full_name: 'Ahmed Al-Hassan',
  email: 'ahmed@example.com',
  password: 'a-genuinely-long-passphrase',
  birth_date: '1995-06-20',
  role: 'Student',
  privacy_consent_version: 'v1.0',
};

describe('registerSchema — valid inputs', () => {
  it('accepts a valid adult registration payload', () => {
    const result = registerSchema.safeParse(validAdultPayload);
    expect(result.success).toBe(true);
  });

  it('accepts a valid minor payload with guardian_email different from email', () => {
    const result = registerSchema.safeParse({
      ...validAdultPayload,
      email: 'sara@example.com',
      guardian_email: 'parent@example.com',
    });
    expect(result.success).toBe(true);
  });
});

describe('registerSchema — invalid inputs (must reject)', () => {
  it('rejects password shorter than 15 characters (NFR-01)', () => {
    const result = registerSchema.safeParse({ ...validAdultPayload, password: 'short' });
    expect(result.success).toBe(false);
  });

  it('rejects a blocklisted common password (NFR-02)', () => {
    const result = registerSchema.safeParse({
      ...validAdultPayload,
      password: 'password123456',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid email format', () => {
    const result = registerSchema.safeParse({ ...validAdultPayload, email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects role outside [Student, Instructor] (e.g. Admin)', () => {
    const result = registerSchema.safeParse({ ...validAdultPayload, role: 'Admin' });
    expect(result.success).toBe(false);
  });

  it('rejects guardian_email equal to email (MUC-AUTH-09)', () => {
    const result = registerSchema.safeParse({
      ...validAdultPayload,
      guardian_email: validAdultPayload.email,
    });
    expect(result.success).toBe(false);
  });

  it('rejects malformed birth_date', () => {
    const result = registerSchema.safeParse({ ...validAdultPayload, birth_date: '20-01-1995' });
    expect(result.success).toBe(false);
  });

  it('rejects missing privacy_consent_version', () => {
    // eslint-disable-next-line no-unused-vars -- intentional: destructuring to OMIT this key from `rest`
    const { privacy_consent_version, ...rest } = validAdultPayload;
    const result = registerSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});
