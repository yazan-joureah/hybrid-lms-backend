const { quizCreateSchema, quizUpdateSchema } = require('../../src/validators/quizSchemas');
const { Types } = require('mongoose');

const validCourseId = new Types.ObjectId().toString();
const validUnitId = new Types.ObjectId().toString();

const baseQuestion = {
  question_type: 'mcq',
  text: 'What is 2 + 2?',
  choices: [
    { text: '3', is_correct: false },
    { text: '4', is_correct: true },
    { text: '5', is_correct: false },
  ],
};

const validQuizPayload = {
  course_id: validCourseId,
  unit_id: validUnitId,
  quiz_type: 'quiz',
  title: 'Unit 1 Quiz',
  start_time: '2026-08-10T09:00:00.000Z',
  end_time: '2026-08-10T10:00:00.000Z',
  duration_minutes: 30,
  passing_score_percent: 60,
  questions: [baseQuestion],
};

describe('quizCreateSchema — valid inputs', () => {
  it('accepts a valid unit quiz payload', () => {
    expect(quizCreateSchema.safeParse(validQuizPayload).success).toBe(true);
  });

  it('accepts a valid exam payload with unit_id omitted', () => {
    const { unit_id: _unit_id, ...examPayload } = { ...validQuizPayload, quiz_type: 'exam' };
    expect(quizCreateSchema.safeParse(examPayload).success).toBe(true);
  });

  it('accepts a true_false question with exactly 2 choices', () => {
    const result = quizCreateSchema.safeParse({
      ...validQuizPayload,
      questions: [
        {
          question_type: 'true_false',
          text: 'The sky is blue.',
          choices: [
            { text: 'True', is_correct: true },
            { text: 'False', is_correct: false },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('quizCreateSchema — cross-field rules (must reject)', () => {
  it('rejects end_time before start_time', () => {
    const result = quizCreateSchema.safeParse({
      ...validQuizPayload,
      start_time: '2026-08-10T10:00:00.000Z',
      end_time: '2026-08-10T09:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects quiz_type="quiz" with unit_id missing', () => {
    const { unit_id: _unit_id, ...payload } = validQuizPayload;
    const result = quizCreateSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects quiz_type="exam" with unit_id present', () => {
    const result = quizCreateSchema.safeParse({ ...validQuizPayload, quiz_type: 'exam' });
    expect(result.success).toBe(false);
  });

  it('rejects a question with zero correct choices', () => {
    const result = quizCreateSchema.safeParse({
      ...validQuizPayload,
      questions: [
        {
          question_type: 'mcq',
          text: 'Bad question',
          choices: [
            { text: 'A', is_correct: false },
            { text: 'B', is_correct: false },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a question with two correct choices', () => {
    const result = quizCreateSchema.safeParse({
      ...validQuizPayload,
      questions: [
        {
          question_type: 'mcq',
          text: 'Bad question',
          choices: [
            { text: 'A', is_correct: true },
            { text: 'B', is_correct: true },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a true_false question with 3 choices', () => {
    const result = quizCreateSchema.safeParse({
      ...validQuizPayload,
      questions: [
        {
          question_type: 'true_false',
          text: 'Bad',
          choices: [
            { text: 'A', is_correct: true },
            { text: 'B', is_correct: false },
            { text: 'C', is_correct: false },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty questions array', () => {
    const result = quizCreateSchema.safeParse({ ...validQuizPayload, questions: [] });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed course_id (not a 24-char hex string)', () => {
    const result = quizCreateSchema.safeParse({ ...validQuizPayload, course_id: 'not-an-id' });
    expect(result.success).toBe(false);
  });
});

describe('quizUpdateSchema — partial updates (regression guard for the .refine()/.partial() ordering bug)', () => {
  it('does NOT throw at require-time and accepts a title-only partial update', () => {
    // This is the exact scenario that would have crashed the app on boot
    // if quizUpdateSchema had been built via quizCreateSchema.partial()
    // directly on an already-refined (ZodEffects) schema.
    const result = quizUpdateSchema.safeParse({ title: 'New Title Only' });
    expect(result.success).toBe(true);
  });

  it('accepts an empty object (no fields changed)', () => {
    expect(quizUpdateSchema.safeParse({}).success).toBe(true);
  });

  it('still rejects end_time before start_time WHEN BOTH are present in the partial payload', () => {
    const result = quizUpdateSchema.safeParse({
      start_time: '2026-08-10T10:00:00.000Z',
      end_time: '2026-08-10T09:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('does NOT reject start_time alone (end_time absent from this partial payload)', () => {
    const result = quizUpdateSchema.safeParse({ start_time: '2026-08-10T09:00:00.000Z' });
    expect(result.success).toBe(true);
  });

  it('still rejects quiz_type="exam" + unit_id present, even in a partial payload', () => {
    const result = quizUpdateSchema.safeParse({ quiz_type: 'exam', unit_id: validUnitId });
    expect(result.success).toBe(false);
  });
});
