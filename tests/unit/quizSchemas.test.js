// src/validators/quizSchemas.test.js
const {
  quizCreateSchema,
  quizUpdateSchema,
  submitAnswerSchema,
} = require('../../src/validators/quizSchemas');
const { Types } = require('mongoose');

const oid = () => new Types.ObjectId().toString();

function baseQuestion(overrides = {}) {
  return {
    question_type: 'mcq',
    text: 'What is 2 + 2?',
    choices: [
      { text: '3', is_correct: false },
      { text: '4', is_correct: true },
    ],
    ...overrides,
  };
}

function baseQuizPayload(overrides = {}) {
  return {
    course_id: oid(),
    unit_id: oid(),
    quiz_type: 'quiz',
    title: 'Unit Quiz',
    duration_minutes: 20,
    passing_score_percent: 60,
    questions: [baseQuestion()],
    ...overrides,
  };
}

describe('questionSchema — choices integrity', () => {
  it('rejects a question with zero correct choices', () => {
    const payload = baseQuizPayload({
      questions: [
        baseQuestion({
          choices: [
            { text: 'A', is_correct: false },
            { text: 'B', is_correct: false },
          ],
        }),
      ],
    });
    expect(quizCreateSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects a question with more than one correct choice', () => {
    const payload = baseQuizPayload({
      questions: [
        baseQuestion({
          choices: [
            { text: 'A', is_correct: true },
            { text: 'B', is_correct: true },
          ],
        }),
      ],
    });
    expect(quizCreateSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects a true_false question that does not have exactly 2 choices', () => {
    const payload = baseQuizPayload({
      questions: [
        baseQuestion({
          question_type: 'true_false',
          choices: [
            { text: 'True', is_correct: true },
            { text: 'False', is_correct: false },
            { text: 'Maybe', is_correct: false },
          ],
        }),
      ],
    });
    expect(quizCreateSchema.safeParse(payload).success).toBe(false);
  });

  it('accepts a valid true_false question with exactly 2 choices', () => {
    const payload = baseQuizPayload({
      questions: [
        baseQuestion({
          question_type: 'true_false',
          choices: [
            { text: 'True', is_correct: true },
            { text: 'False', is_correct: false },
          ],
        }),
      ],
    });
    expect(quizCreateSchema.safeParse(payload).success).toBe(true);
  });
});

describe('quizCreateSchema — quiz vs exam structural rules', () => {
  it('requires unit_id when quiz_type is "quiz"', () => {
    const { unit_id: _unit_id, ...payload } = baseQuizPayload();
    expect(quizCreateSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects unit_id being present when quiz_type is "exam"', () => {
    const payload = baseQuizPayload({
      quiz_type: 'exam',
      start_time: '2026-08-10T09:00:00.000Z',
      end_time: '2026-08-10T10:00:00.000Z',
    });
    expect(quizCreateSchema.safeParse(payload).success).toBe(false);
  });

  it('requires start_time AND end_time when quiz_type is "exam"', () => {
    const { unit_id: _unit_id, ...payload } = baseQuizPayload({ quiz_type: 'exam' });
    expect(quizCreateSchema.safeParse(payload).success).toBe(false);
  });

  it('accepts a valid exam with unit_id omitted and a valid time window', () => {
    const { unit_id: _unit_id, ...payload } = baseQuizPayload({
      quiz_type: 'exam',
      start_time: '2026-08-10T09:00:00.000Z',
      end_time: '2026-08-10T10:00:00.000Z',
    });
    expect(quizCreateSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects end_time before or equal to start_time', () => {
    const payload = baseQuizPayload({
      start_time: '2026-08-10T10:00:00.000Z',
      end_time: '2026-08-10T09:00:00.000Z',
    });
    expect(quizCreateSchema.safeParse(payload).success).toBe(false);
  });
});
describe('quizUpdateSchema', () => {
  it('accepts a partial update with a single field', () => {
    expect(quizUpdateSchema.safeParse({ title: 'New Title' }).success).toBe(true);
  });

  it('still enforces end_time > start_time when both are provided in a partial update', () => {
    const result = quizUpdateSchema.safeParse({
      start_time: '2026-08-10T10:00:00.000Z',
      end_time: '2026-08-10T09:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('does not require quiz_type/course_id/questions at all (true partial)', () => {
    expect(quizUpdateSchema.safeParse({ passing_score_percent: 80 }).success).toBe(true);
  });

  it('silently ignores quiz_type/unit_id in update payloads — they are immutable after creation', () => {
    const result = quizUpdateSchema.safeParse({
      title: 'New title',
      quiz_type: 'exam',
      unit_id: oid(),
    });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('quiz_type');
    expect(result.data).not.toHaveProperty('unit_id');
  });
});

describe('submitAnswerSchema', () => {
  it('accepts valid ObjectId strings', () => {
    expect(
      submitAnswerSchema.safeParse({
        question_id: oid(),
        selected_choice_id: oid(),
      }).success
    ).toBe(true);
  });

  it('rejects malformed ObjectId strings', () => {
    expect(
      submitAnswerSchema.safeParse({
        question_id: 'not-an-id',
        selected_choice_id: oid(),
      }).success
    ).toBe(false);
  });
});
