// tests/unit/schemas.test.js
//
// Dedicated schema-validation coverage for adminSchemas, kycSchemas, and
// userSchemas — previously only authSchemas.test.js existed.
//
// Added quizSchemas coverage to reach branch 100%.

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

// ========== ADDED: quizSchemas coverage ==========
const {
  quizCreateSchema,
  quizUpdateSchema,
  submitAnswerSchema,
} = require('../../src/validators/quizSchemas');

describe('quizSchemas', () => {
  // Helper to generate a valid question object
  function validQuestion(overrides = {}) {
    return {
      question_type: 'mcq',
      text: 'What is 2+2?',
      choices: [
        { text: '4', is_correct: true },
        { text: '5', is_correct: false },
      ],
      ...overrides,
    };
  }

  function validCreatePayload(overrides = {}) {
    return {
      course_id: '507f1f77bcf86cd799439011',
      quiz_type: 'quiz',
      unit_id: '507f1f77bcf86cd799439012',
      title: 'Sample Quiz',
      description: 'Test description',
      start_time: new Date('2025-01-01T00:00:00Z'),
      end_time: new Date('2025-01-02T00:00:00Z'),
      duration_minutes: 30,
      passing_score_percent: 70,
      max_attempts: 2,
      allow_back_navigation: true,
      questions: [validQuestion()],
      ...overrides,
    };
  }

  describe('quizCreateSchema', () => {
    it('accepts a valid quiz payload', () => {
      const result = quizCreateSchema.safeParse(validCreatePayload());
      expect(result.success).toBe(true);
    });

    it('accepts a valid exam payload (unit_id omitted)', () => {
      const payload = validCreatePayload({ quiz_type: 'exam', unit_id: undefined });
      const result = quizCreateSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('rejects when unit_id is missing for quiz_type "quiz"', () => {
      const payload = validCreatePayload({ unit_id: undefined });
      const result = quizCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toContain('unit_id');
      expect(result.error.issues[0].message).toMatch(/required/i);
    });

    it('rejects when unit_id is provided for quiz_type "exam"', () => {
      const payload = validCreatePayload({
        quiz_type: 'exam',
        unit_id: '507f1f77bcf86cd799439012',
      });
      const result = quizCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toContain('unit_id');
      expect(result.error.issues[0].message).toMatch(/must not be provided/i);
    });

    it('rejects when end_time is before start_time', () => {
      const payload = validCreatePayload({
        start_time: new Date('2025-01-02T00:00:00Z'),
        end_time: new Date('2025-01-01T00:00:00Z'),
      });
      const result = quizCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toContain('end_time');
      expect(result.error.issues[0].message).toMatch(/after start_time/i);
    });

    it('rejects when end_time equals start_time', () => {
      const date = new Date('2025-01-01T00:00:00Z');
      const payload = validCreatePayload({ start_time: date, end_time: date });
      const result = quizCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toContain('end_time');
    });

    it('rejects malformed ObjectId for course_id', () => {
      const payload = validCreatePayload({ course_id: 'invalid-id' });
      const result = quizCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toContain('course_id');
    });

    it('rejects malformed ObjectId for unit_id', () => {
      const payload = validCreatePayload({ unit_id: 'bad' });
      const result = quizCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toContain('unit_id');
    });

    it('rejects when questions array is empty', () => {
      const payload = validCreatePayload({ questions: [] });
      const result = quizCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toContain('questions');
    });

    it('rejects when a question has fewer than 2 choices', () => {
      const q = validQuestion({ choices: [{ text: 'Only one', is_correct: true }] });
      const payload = validCreatePayload({ questions: [q] });
      const result = quizCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toEqual(['questions', 0, 'choices']);
    });

    it('rejects when a question has multiple correct choices', () => {
      const q = validQuestion({
        choices: [
          { text: 'A', is_correct: true },
          { text: 'B', is_correct: true },
        ],
      });
      const payload = validCreatePayload({ questions: [q] });
      const result = quizCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toEqual(['questions', 0, 'choices']);
    });

    it('rejects true_false question with not exactly 2 choices', () => {
      const q = validQuestion({
        question_type: 'true_false',
        choices: [
          { text: 'True', is_correct: true },
          { text: 'False', is_correct: false },
          { text: 'Maybe', is_correct: false },
        ],
      });
      const payload = validCreatePayload({ questions: [q] });
      const result = quizCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toEqual(['questions', 0, 'choices']);
    });
  });

  describe('quizUpdateSchema', () => {
    it('accepts a partial update with only title', () => {
      const result = quizUpdateSchema.safeParse({ title: 'New Title' });
      expect(result.success).toBe(true);
    });

    it('accepts a full valid update', () => {
      const payload = {
        title: 'Updated',
        description: 'New desc',
        start_time: new Date('2025-02-01T00:00:00Z'),
        end_time: new Date('2025-02-02T00:00:00Z'),
        duration_minutes: 45,
        passing_score_percent: 80,
        max_attempts: 1,
        allow_back_navigation: false,
        questions: [validQuestion({ text: 'New question' })],
      };
      const result = quizUpdateSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('rejects when end_time < start_time when both provided', () => {
      const payload = {
        start_time: new Date('2025-02-02T00:00:00Z'),
        end_time: new Date('2025-02-01T00:00:00Z'),
      };
      const result = quizUpdateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toContain('end_time');
    });

    it('accepts when only start_time or only end_time is provided (no constraint)', () => {
      const result1 = quizUpdateSchema.safeParse({ start_time: new Date() });
      expect(result1.success).toBe(true);
      const result2 = quizUpdateSchema.safeParse({ end_time: new Date() });
      expect(result2.success).toBe(true);
    });
  });

  describe('submitAnswerSchema', () => {
    it('accepts valid question_id and selected_choice_id', () => {
      const payload = {
        question_id: '507f1f77bcf86cd799439011',
        selected_choice_id: '507f1f77bcf86cd799439012',
      };
      expect(submitAnswerSchema.safeParse(payload).success).toBe(true);
    });

    it('rejects invalid ObjectId format for question_id', () => {
      const payload = {
        question_id: 'invalid',
        selected_choice_id: '507f1f77bcf86cd799439012',
      };
      expect(submitAnswerSchema.safeParse(payload).success).toBe(false);
    });

    it('rejects invalid ObjectId format for selected_choice_id', () => {
      const payload = {
        question_id: '507f1f77bcf86cd799439011',
        selected_choice_id: 'bad',
      };
      expect(submitAnswerSchema.safeParse(payload).success).toBe(false);
    });

    it('rejects missing fields', () => {
      expect(submitAnswerSchema.safeParse({ question_id: '507f...' }).success).toBe(false);
      expect(submitAnswerSchema.safeParse({ selected_choice_id: '507f...' }).success).toBe(false);
    });
  });
});
