// quizSession.service.gaps.test.js
jest.mock('../../src/models/quiz.model');
jest.mock('../../src/models/quizAttempt.model');
jest.mock('../../src/models/Enrollment');
jest.mock('../../src/services/auditService', () => ({ record: jest.fn().mockResolvedValue() }));
jest.mock('../../src/middleware/errorHandler', () => {
  class AppError extends Error {
    constructor(status, code, message) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return { AppError };
});
jest.mock('../../src/utils/objectId.util', () => {
  const { Types } = require('mongoose');
  return { toObjectId: (val) => (val instanceof Types.ObjectId ? val : new Types.ObjectId(val)) };
});

const { Types } = require('mongoose');
const Quiz = require('../../src/models/quiz.model');
const QuizAttempt = require('../../src/models/quizAttempt.model');
const Enrollment = require('../../src/models/Enrollment');
const {
  checkQuizEligibility,
  getAttemptForResume,
  getCurrentAttempt,
} = require('../../src/services/quiz/quizSession.service');

const oid = () => new Types.ObjectId();
beforeEach(() => jest.resetAllMocks());

// ---------------------------------------------------------------------------
// getAttemptForResume — previously had ZERO coverage despite being exposed
// on GET /attempts/:attemptId
// ---------------------------------------------------------------------------
describe('getAttemptForResume', () => {
  const studentId = oid();
  const attemptId = oid();
  const quizId = oid();
  const q1 = oid();
  const c1 = oid();
  const c2 = oid();

  it("returns the sanitized quiz plus this student's previous answers", async () => {
    QuizAttempt.findOne.mockResolvedValue({
      _id: attemptId,
      student_id: studentId,
      quiz_id: quizId,
      status: 'in_progress',
      expires_at: new Date(Date.now() + 60000),
      shuffled_question_order: [{ question_id: q1, shuffled_choice_ids: [c2, c1] }],
      answers: [{ question_id: q1, selected_choice_id: c1 }],
    });
    Quiz.findById.mockResolvedValue({
      _id: quizId,
      title: 'T',
      duration_minutes: 10,
      passing_score_percent: 50,
      questions: [
        {
          _id: q1,
          question_type: 'mcq',
          text: 'Q?',
          choices: [
            { _id: c1, text: 'A', is_correct: true },
            { _id: c2, text: 'B', is_correct: false },
          ],
        },
      ],
    });

    const result = await getAttemptForResume({ studentId, attemptId });

    expect(result.data.attempt_id).toEqual(attemptId);
    expect(result.data.previous_answers).toEqual([{ question_id: q1, selected_choice_id: c1 }]);
    // security guarantee: no is_correct leak on resume, same as on start
    expect(JSON.stringify(result.data.quiz)).not.toMatch(/is_correct/);
  });

  it("throws 404 ATTEMPT_NOT_FOUND for another student's attempt (IDOR guard)", async () => {
    QuizAttempt.findOne.mockResolvedValue(null);
    await expect(getAttemptForResume({ studentId, attemptId })).rejects.toMatchObject({
      status: 404,
      code: 'ATTEMPT_NOT_FOUND',
    });
  });

  it('throws 409 ATTEMPT_NOT_IN_PROGRESS for an already-graded attempt', async () => {
    QuizAttempt.findOne.mockResolvedValue({
      _id: attemptId,
      student_id: studentId,
      status: 'graded',
      expires_at: new Date(Date.now() + 60000),
    });
    await expect(getAttemptForResume({ studentId, attemptId })).rejects.toMatchObject({
      status: 409,
      code: 'ATTEMPT_NOT_IN_PROGRESS',
    });
  });

  it('auto-submits and throws 409 ATTEMPT_TIMED_OUT for an expired attempt', async () => {
    const attempt = {
      _id: attemptId,
      student_id: studentId,
      quiz_id: quizId,
      status: 'in_progress',
      expires_at: new Date(Date.now() - 1000),
      answers: [],
      save: jest.fn().mockResolvedValue(true),
    };
    QuizAttempt.findOne.mockResolvedValue(attempt);
    Quiz.findById.mockResolvedValue({ _id: quizId, questions: [], passing_score_percent: 50 });

    await expect(getAttemptForResume({ studentId, attemptId })).rejects.toMatchObject({
      status: 409,
      code: 'ATTEMPT_TIMED_OUT',
    });
    expect(attempt.status).toBe('graded'); // ran through autoSubmit + grade
  });
});

// ---------------------------------------------------------------------------
// getCurrentAttempt — the "found and still active" branch had no coverage
// ---------------------------------------------------------------------------
describe('getCurrentAttempt (success branch)', () => {
  it('returns the active attempt with sanitized quiz and previous answers', async () => {
    const studentId = oid();
    const quizId = oid();
    const q1 = oid();
    const c1 = oid();

    QuizAttempt.findOne.mockResolvedValue({
      _id: oid(),
      student_id: studentId,
      quiz_id: quizId,
      status: 'in_progress',
      expires_at: new Date(Date.now() + 60000),
      shuffled_question_order: [{ question_id: q1, shuffled_choice_ids: [c1] }],
      answers: [{ question_id: q1, selected_choice_id: c1 }],
    });
    Quiz.findById.mockResolvedValue({
      _id: quizId,
      questions: [
        {
          _id: q1,
          question_type: 'mcq',
          text: 'Q?',
          choices: [{ _id: c1, text: 'A', is_correct: true }],
        },
      ],
      passing_score_percent: 50,
    });

    const result = await getCurrentAttempt({ studentId, quizId, req: {} });

    expect(result.data).not.toBeNull();
    expect(result.data.previous_answers).toHaveLength(1);
    expect(JSON.stringify(result.data.quiz)).not.toMatch(/is_correct/);
  });
});

// quizSession.service.gaps.test.js — replace the previous
// "checkQuizEligibility — max_attempts is undefined" describe block with this:

describe('checkQuizEligibility — no daily cap configured', () => {
  it('skips the daily-attempts query entirely and does not block the student', async () => {
    const studentId = oid();
    const quizId = oid();
    Enrollment.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: oid() }) });
    Quiz.findById.mockResolvedValue({
      _id: quizId,
      status: 'published',
      course_id: oid(),
      start_time: null,
      end_time: null,
      max_attempts: undefined,
    });
    // Only the lifetime count should be requested — the daily cap
    // check must be skipped entirely when max_attempts is unset.
    QuizAttempt.countDocuments.mockResolvedValueOnce(5); // lifetime

    const result = await checkQuizEligibility({ studentId, quizId });

    expect(QuizAttempt.countDocuments).toHaveBeenCalledTimes(1);
    expect(result.lifetimeAttemptsCount).toBe(5);
  });

  it('also skips the daily cap when max_attempts is 0', async () => {
    const studentId = oid();
    const quizId = oid();
    Enrollment.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: oid() }) });
    Quiz.findById.mockResolvedValue({
      _id: quizId,
      status: 'published',
      course_id: oid(),
      start_time: null,
      end_time: null,
      max_attempts: 0,
    });
    QuizAttempt.countDocuments.mockResolvedValueOnce(1000); // lifetime

    await expect(checkQuizEligibility({ studentId, quizId })).resolves.toBeDefined();
    expect(QuizAttempt.countDocuments).toHaveBeenCalledTimes(1);
  });
});

describe('checkQuizEligibility — daily cap enforced when configured', () => {
  it('still blocks the student once the daily cap is reached', async () => {
    const studentId = oid();
    const quizId = oid();
    Enrollment.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: oid() }) });
    Quiz.findById.mockResolvedValue({
      _id: quizId,
      status: 'published',
      course_id: oid(),
      start_time: null,
      end_time: null,
      max_attempts: 2,
    });
    QuizAttempt.countDocuments.mockResolvedValueOnce(2); // daily

    await expect(checkQuizEligibility({ studentId, quizId })).rejects.toMatchObject({
      status: 403,
      code: 'ATTEMPTS_EXHAUSTED',
    });
    expect(QuizAttempt.countDocuments).toHaveBeenCalledTimes(1); // stops before lifetime count
  });
});
