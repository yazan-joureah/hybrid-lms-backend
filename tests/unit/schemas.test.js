// tests/unit/schemas.test.js
//
// Dedicated schema-validation coverage for adminSchemas, kycSchemas, and
// userSchemas — previously only authSchemas.test.js existed.

const {
  setAccountStatusSchema,
  createAdminAccountSchema,
  deleteAccountSchema,
  reviewDeletionRequestSchema,
  restoreRequestSchema,
  restoreConfirmSchema,
} = require('../../src/validators/adminSchemas');

describe('adminSchemas', () => {
  describe('setAccountStatusSchema', () => {
    it('accepts a valid suspend payload', () => {
      expect(
        setAccountStatusSchema.safeParse({ action: 'suspend', reason: 'policy violation' }).success
      ).toBe(true);
    });

    it('rejects an empty reason (mandatory per UC-AUTH-08.1/08.2)', () => {
      expect(setAccountStatusSchema.safeParse({ action: 'suspend', reason: '' }).success).toBe(
        false
      );
    });

    it('rejects an action outside [suspend, activate]', () => {
      expect(setAccountStatusSchema.safeParse({ action: 'delete', reason: 'x' }).success).toBe(
        false
      );
    });

    it('rejects a reason longer than 500 characters', () => {
      const longReason = 'x'.repeat(501);
      expect(
        setAccountStatusSchema.safeParse({ action: 'suspend', reason: longReason }).success
      ).toBe(false);
    });
  });

  describe('createAdminAccountSchema', () => {
    it('accepts a valid email + fullName', () => {
      expect(
        createAdminAccountSchema.safeParse({ email: 'a@example.com', fullName: 'Ali' }).success
      ).toBe(true);
    });

    it('rejects an invalid email', () => {
      expect(
        createAdminAccountSchema.safeParse({ email: 'not-an-email', fullName: 'Ali' }).success
      ).toBe(false);
    });
  });

  describe('deleteAccountSchema', () => {
    it('requires a non-empty reason', () => {
      expect(deleteAccountSchema.safeParse({ reason: 'x' }).success).toBe(true);
      expect(deleteAccountSchema.safeParse({ reason: '' }).success).toBe(false);
      expect(deleteAccountSchema.safeParse({}).success).toBe(false);
    });

    it('rejects a reason longer than 500 characters', () => {
      const longReason = 'x'.repeat(501);
      expect(deleteAccountSchema.safeParse({ reason: longReason }).success).toBe(false);
    });
  });

  describe('reviewDeletionRequestSchema — conditional requirement', () => {
    it('approve without decisionReason is valid', () => {
      expect(reviewDeletionRequestSchema.safeParse({ decision: 'approve' }).success).toBe(true);
    });

    it('reject WITHOUT decisionReason is invalid', () => {
      expect(reviewDeletionRequestSchema.safeParse({ decision: 'reject' }).success).toBe(false);
    });

    it('reject WITH decisionReason is valid', () => {
      expect(
        reviewDeletionRequestSchema.safeParse({
          decision: 'reject',
          decisionReason: 'insufficient justification',
        }).success
      ).toBe(true);
    });
  });

  describe('restoreRequestSchema / restoreConfirmSchema', () => {
    it('restoreRequestSchema normalizes email to lowercase', () => {
      const result = restoreRequestSchema.safeParse({ email: 'USER@Example.com' });
      expect(result.success).toBe(true);
      expect(result.data.email).toBe('user@example.com');
    });

    it('restoreRequestSchema rejects missing email', () => {
      expect(restoreRequestSchema.safeParse({}).success).toBe(false);
    });

    it('restoreConfirmSchema rejects a code that is not exactly 6 digits', () => {
      expect(
        restoreConfirmSchema.safeParse({ email: 'user@example.com', code: '12345' }).success
      ).toBe(false);
    });

    it('restoreConfirmSchema rejects missing email or code', () => {
      expect(restoreConfirmSchema.safeParse({ email: 'a@b.com' }).success).toBe(false);
      expect(restoreConfirmSchema.safeParse({ code: '123456' }).success).toBe(false);
    });
  });
});

const {
  kycSubmitSchema,
  kycApproveSchema,
  kycRejectSchema,
} = require('../../src/validators/kycSchemas');

describe('kycSchemas', () => {
  describe('kycSubmitSchema', () => {
    it('accepts national_id and passport, rejects anything else', () => {
      expect(kycSubmitSchema.safeParse({ idDocumentType: 'national_id' }).success).toBe(true);
      expect(kycSubmitSchema.safeParse({ idDocumentType: 'passport' }).success).toBe(true);
      expect(kycSubmitSchema.safeParse({ idDocumentType: 'drivers_license' }).success).toBe(false);
    });

    it('rejects missing idDocumentType', () => {
      expect(kycSubmitSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('kycApproveSchema', () => {
    it('accepts a valid ISO documentBirthDate with an optional note', () => {
      expect(
        kycApproveSchema.safeParse({ documentBirthDate: '1995-06-20', optionalNote: 'looks fine' })
          .success
      ).toBe(true);
    });

    it('rejects a malformed date', () => {
      expect(kycApproveSchema.safeParse({ documentBirthDate: '20-06-1995' }).success).toBe(false);
    });

    it('rejects an optionalNote over 500 chars', () => {
      expect(
        kycApproveSchema.safeParse({
          documentBirthDate: '1995-06-20',
          optionalNote: 'x'.repeat(501),
        }).success
      ).toBe(false);
    });

    it('rejects missing documentBirthDate', () => {
      expect(kycApproveSchema.safeParse({ optionalNote: 'fine' }).success).toBe(false);
    });
  });

  describe('kycRejectSchema — reason must be from the classified list', () => {
    it('accepts a valid classified reason', () => {
      expect(kycRejectSchema.safeParse({ rejectionReason: 'UNCLEAR_IMAGE' }).success).toBe(true);
    });

    it('rejects a free-text reason not in REJECTION_REASONS', () => {
      expect(kycRejectSchema.safeParse({ rejectionReason: 'looks fake to me' }).success).toBe(
        false
      );
    });

    it('rejects missing rejectionReason', () => {
      expect(kycRejectSchema.safeParse({}).success).toBe(false);
    });
  });
});

const { updateProfileSchema } = require('../../src/validators/userSchemas');

describe('userSchemas — updateProfileSchema (partial update)', () => {
  it('accepts an empty object (all fields optional)', () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a valid partial update (full_name only)', () => {
    expect(updateProfileSchema.safeParse({ full_name: 'New Name' }).success).toBe(true);
  });

  it('rejects full_name shorter than 2 chars', () => {
    expect(updateProfileSchema.safeParse({ full_name: 'A' }).success).toBe(false);
  });

  it('accepts a valid phone number and allows clearing it with an empty string', () => {
    expect(updateProfileSchema.safeParse({ phone: '+9665551234' }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ phone: '' }).success).toBe(true);
  });

  it('rejects a malformed phone number', () => {
    expect(updateProfileSchema.safeParse({ phone: 'abc123' }).success).toBe(false);
  });

  it('rejects bio over 500 chars but allows clearing it with an empty string', () => {
    expect(updateProfileSchema.safeParse({ bio: 'x'.repeat(501) }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ bio: '' }).success).toBe(true);
  });

  it('rejects a malformed birth_date', () => {
    expect(updateProfileSchema.safeParse({ birth_date: '1995/06/20' }).success).toBe(false);
  });
});

// ========== ADDED: requestOwnDeletionSchema (from authSchemas) ==========
const { requestOwnDeletionSchema } = require('../../src/validators/authSchemas');

describe('requestOwnDeletionSchema', () => {
  it('accepts a valid reason', () => {
    expect(requestOwnDeletionSchema.safeParse({ reason: 'leaving platform' }).success).toBe(true);
  });
  it('rejects empty reason', () => {
    expect(requestOwnDeletionSchema.safeParse({ reason: '' }).success).toBe(false);
  });
  it('rejects reason longer than 500 characters', () => {
    expect(requestOwnDeletionSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
  });
});
