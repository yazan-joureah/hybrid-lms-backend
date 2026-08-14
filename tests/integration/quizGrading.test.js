/**
 * Integration tests for UC-QUIZ-02 (submitAnswer) + UC-QUIZ-03
 * (auto-submit on timeout) + UC-QUIZ-04 (grading, manual + auto paths).
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const User = require('../../src/models/User');
const Course = require('../../src/models/Course');
const CourseUnit = require('../../src/models/CourseUnit');
const Enrollment = require('../../src/models/Enrollment');
const Quiz = require('../../src/models/quiz.model');
const QuizAttempt = require('../../src/models/quizAttempt.model');
const Session = require('../../src/models/Session');
const { hashPassword } = require('../../src/utils/crypto');
const redisClient = require('../../src/config/redis');
const { signAccessToken } = require('../../src/utils/jwt');

const PLAIN_PASSWORD = 'a-genuinely-long-passphrase-2026';

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI);
  }
}, 20000);

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Course.deleteMany({}),
    CourseUnit.deleteMany({}),
    Enrollment.deleteMany({}),
    Quiz.deleteMany({}),
    QuizAttempt.deleteMany({}),
    Session.deleteMany({}),
  ]);
  if (redisClient.isOpen) await redisClient.flushdb();
});

afterAll(async () => {
  await mongoose.connection.close();
  await redisClient.quit();
});

async function createUserAndLogin({ role = 'Student', email = 'student@example.com' } = {}) {
  const passwordHash = await hashPassword(PLAIN_PASSWORD);
  const user = await User.create({
    full_name: 'Test User',
    email,
    password_hash: passwordHash,
    birth_date: new Date('1995-01-01'),
    role,
    status: 'active',
    email_verified_at: new Date(),
    privacy_consent: {
      policy_version: 'v1.0',
      accepted_at: new Date(),
      ip: '127.0.0.1',
      user_agent: 'jest',
    },
  });
  const session = await Session.create({
    user_id: user._id,
    device_fingerprint: 'test-fingerprint',
    ip_address: '127.0.0.1',
    user_agent: 'jest',
    mfa_verified: false,
    status: 'active',
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  const accessToken = signAccessToken({ userId: user._id, sessionId: session._id });
  return { accessToken, user };
}

async function setupQuizWithEnrolledStudent(overrides = {}) {
  const instructor = await createUserAndLogin({
    role: 'Instructor',
    email: 'instructor@example.com',
  });
  const course = await Course.create({
    title: 'Security 101',
    description: 'desc',
    category: 'Technology & Computer Science',
    course_type: 'free',
    is_synchronous: false,
    owner_instructor_id: instructor.user._id,
    status: 'published',
  });
  const unit = await CourseUnit.create({ course_id: course._id, title: 'Unit 1', order: 1 });

  const quiz = await Quiz.create({
    course_id: course._id,
    unit_id: unit._id,
    instructor_id: instructor.user._id,
    quiz_type: 'quiz',
    title: 'Unit 1 Quiz',
    start_time: new Date(Date.now() - 60 * 60 * 1000),
    end_time: new Date(Date.now() + 60 * 60 * 1000),
    duration_minutes: overrides.duration_minutes ?? 30,
    passing_score_percent: overrides.passing_score_percent ?? 50,
    max_attempts: 2,
    status: 'published',
    locked: false,
    questions: [
      {
        question_type: 'mcq',
        text: 'Q1: capital of France?',
        choices: [
          { text: 'Berlin', is_correct: false },
          { text: 'Paris', is_correct: true },
        ],
      },
      {
        question_type: 'true_false',
        text: 'Q2: the sky is blue',
        choices: [
          { text: 'True', is_correct: true },
          { text: 'False', is_correct: false },
        ],
      },
    ],
  });

  const student = await createUserAndLogin({ role: 'Student', email: 'student@example.com' });
  await Enrollment.create({
    course_id: course._id,
    student_id: student.user._id,
    status: 'active',
    confirmed_by_student: true,
  });

  return { instructor, course, unit, quiz, student };
}

async function startAttempt(quiz, student) {
  const res = await request(app)
    .post(`/api/v1/quizzes/${quiz._id}/start`)
    .set('Authorization', `Bearer ${student.accessToken}`);
  return res.body.data; // { attempt_id, expires_at, quiz: sanitized }
}

describe('POST /api/v1/quizzes/attempts/:attemptId/answers (UC-QUIZ-02 Auto-Save)', () => {
  it('saves an answer and returns answered_count', async () => {
    const { quiz, student } = await setupQuizWithEnrolledStudent();
    const { attempt_id, quiz: sanitized } = await startAttempt(quiz, student);
    const q1 = sanitized.questions[0];
    const [correctChoice] = q1.choices;
    const res = await request(app)
      .post(`/api/v1/quizzes/attempts/${attempt_id}/answers`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ question_id: q1._id, selected_choice_id: correctChoice._id });

    expect(res.status).toBe(200);
    expect(res.body.data.answered_count).toBe(1);
  });

  it('OVERWRITES a previous answer for the same question, not duplicates it', async () => {
    const { quiz, student } = await setupQuizWithEnrolledStudent();
    const { attempt_id, quiz: sanitized } = await startAttempt(quiz, student);
    const q1 = sanitized.questions[0];
    const [choiceA, choiceB] = q1.choices;

    await request(app)
      .post(`/api/v1/quizzes/attempts/${attempt_id}/answers`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ question_id: q1._id, selected_choice_id: choiceA._id });

    const second = await request(app)
      .post(`/api/v1/quizzes/attempts/${attempt_id}/answers`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ question_id: q1._id, selected_choice_id: choiceB._id });

    expect(second.body.data.answered_count).toBe(1); // still 1, not 2

    const stored = await QuizAttempt.findById(attempt_id);
    expect(stored.answers[0].selected_choice_id.toString()).toBe(choiceB._id.toString());
  });

  it('rejects with 400 QUESTION_NOT_IN_ATTEMPT for a question from a different quiz (IDOR guard)', async () => {
    const { quiz, student } = await setupQuizWithEnrolledStudent();
    const { attempt_id } = await startAttempt(quiz, student);
    const foreignQuestionId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .post(`/api/v1/quizzes/attempts/${attempt_id}/answers`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ question_id: foreignQuestionId, selected_choice_id: new mongoose.Types.ObjectId() });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('QUESTION_NOT_IN_ATTEMPT');
  });

  it("rejects with 404 ATTEMPT_NOT_FOUND for another student's attempt (IDOR guard)", async () => {
    const { quiz, student } = await setupQuizWithEnrolledStudent();
    const { attempt_id, quiz: sanitized } = await startAttempt(quiz, student);
    const stranger = await createUserAndLogin({ email: 'stranger@example.com' });

    const res = await request(app)
      .post(`/api/v1/quizzes/attempts/${attempt_id}/answers`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .send({
        question_id: sanitized.questions[0]._id,
        selected_choice_id: sanitized.questions[0].choices[0]._id,
      });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ATTEMPT_NOT_FOUND');
  });
});

describe('POST /api/v1/quizzes/attempts/:attemptId/submit (UC-QUIZ-04, manual path)', () => {
  it('grades correctly: 2/2 correct → 100%, passed=true', async () => {
    const { quiz, student } = await setupQuizWithEnrolledStudent({ passing_score_percent: 50 });
    const { attempt_id } = await startAttempt(quiz, student);

    // answer both correctly — sanitized choices carry no is_correct, so
    // fetch the real quiz to know which shuffled choice_id is correct.
    const realQuiz = await Quiz.findById(quiz._id);
    const attemptDoc = await QuizAttempt.findById(attempt_id);

    for (const shuffledQ of attemptDoc.shuffled_question_order) {
      const realQuestion = realQuiz.questions.id(shuffledQ.question_id);
      const correctChoice = realQuestion.choices.find((c) => c.is_correct);
      // eslint-disable-next-line no-await-in-loop
      await request(app)
        .post(`/api/v1/quizzes/attempts/${attempt_id}/answers`)
        .set('Authorization', `Bearer ${student.accessToken}`)
        .send({ question_id: shuffledQ.question_id, selected_choice_id: correctChoice._id });
    }

    const res = await request(app)
      .post(`/api/v1/quizzes/attempts/${attempt_id}/submit`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.attempt.status).toBe('graded');
    expect(res.body.data.attempt.score_percent).toBe(100);
    expect(res.body.data.attempt.passed).toBe(true);
    expect(res.body.data.attempt.submitted_by).toBe('student');
  });

  it('grades correctly: 0/2 correct → 0%, passed=false', async () => {
    const { quiz, student } = await setupQuizWithEnrolledStudent();
    const { attempt_id } = await startAttempt(quiz, student);

    const realQuiz = await Quiz.findById(quiz._id);
    const attemptDoc = await QuizAttempt.findById(attempt_id);

    for (const shuffledQ of attemptDoc.shuffled_question_order) {
      const realQuestion = realQuiz.questions.id(shuffledQ.question_id);
      const wrongChoice = realQuestion.choices.find((c) => !c.is_correct);
      // eslint-disable-next-line no-await-in-loop
      await request(app)
        .post(`/api/v1/quizzes/attempts/${attempt_id}/answers`)
        .set('Authorization', `Bearer ${student.accessToken}`)
        .send({ question_id: shuffledQ.question_id, selected_choice_id: wrongChoice._id });
    }

    const res = await request(app)
      .post(`/api/v1/quizzes/attempts/${attempt_id}/submit`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.body.data.attempt.score_percent).toBe(0);
    expect(res.body.data.attempt.passed).toBe(false);
  });

  it('grades correctly with UNANSWERED questions counted as wrong (1/2 answered correctly, 1 skipped → 50%)', async () => {
    const { quiz, student } = await setupQuizWithEnrolledStudent({ passing_score_percent: 50 });
    const { attempt_id } = await startAttempt(quiz, student);

    const realQuiz = await Quiz.findById(quiz._id);
    const attemptDoc = await QuizAttempt.findById(attempt_id);
    const firstQuestion = attemptDoc.shuffled_question_order[0];
    const realQuestion = realQuiz.questions.id(firstQuestion.question_id);
    const correctChoice = realQuestion.choices.find((c) => c.is_correct);

    await request(app)
      .post(`/api/v1/quizzes/attempts/${attempt_id}/answers`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ question_id: firstQuestion.question_id, selected_choice_id: correctChoice._id });
    // second question left unanswered entirely

    const res = await request(app)
      .post(`/api/v1/quizzes/attempts/${attempt_id}/submit`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.body.data.attempt.score_percent).toBe(50);
    expect(res.body.data.attempt.passed).toBe(true); // exactly at the 50% threshold
  });

  it('rejects with 409 ATTEMPT_NOT_IN_PROGRESS on a second submit call', async () => {
    const { quiz, student } = await setupQuizWithEnrolledStudent();
    const { attempt_id } = await startAttempt(quiz, student);

    await request(app)
      .post(`/api/v1/quizzes/attempts/${attempt_id}/submit`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    const second = await request(app)
      .post(`/api/v1/quizzes/attempts/${attempt_id}/submit`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ATTEMPT_NOT_IN_PROGRESS');
  });
});

describe('UC-QUIZ-03 — Lazy Evaluation auto-submit on timeout', () => {
  it('auto-submits and grades on the NEXT request once expires_at has passed, using only what was Auto-Saved', async () => {
    const { quiz, student } = await setupQuizWithEnrolledStudent({
      duration_minutes: 30,
      passing_score_percent: 50,
    });
    const { attempt_id } = await startAttempt(quiz, student);

    const realQuiz = await Quiz.findById(quiz._id);
    const attemptDoc = await QuizAttempt.findById(attempt_id);
    const firstQuestion = attemptDoc.shuffled_question_order[0];
    const realQuestion = realQuiz.questions.id(firstQuestion.question_id);
    const correctChoice = realQuestion.choices.find((c) => c.is_correct);

    // Auto-Save one correct answer BEFORE time runs out.
    await request(app)
      .post(`/api/v1/quizzes/attempts/${attempt_id}/answers`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ question_id: firstQuestion.question_id, selected_choice_id: correctChoice._id });

    // Simulate expiry directly at the DB layer (no real 30-min wait in CI).
    await QuizAttempt.updateOne({ _id: attempt_id }, { expires_at: new Date(Date.now() - 1000) });

    // The student's NEXT action (another Auto-Save attempt) is what
    // actually triggers the Lazy Evaluation check — there is no timer.
    const laterRes = await request(app)
      .post(`/api/v1/quizzes/attempts/${attempt_id}/answers`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ question_id: firstQuestion.question_id, selected_choice_id: correctChoice._id });

    expect(laterRes.status).toBe(409);
    expect(laterRes.body.error.code).toBe('ATTEMPT_TIMED_OUT');

    const finalAttempt = await QuizAttempt.findById(attempt_id);
    expect(finalAttempt.status).toBe('graded'); // auto-submit chains straight into grading
    expect(finalAttempt.submitted_by).toBe('system_timeout');
    expect(finalAttempt.score_percent).toBe(50); // only the ONE pre-expiry answer counted
  });

  it('the manual /submit endpoint ALSO detects expiry and treats it as a timeout, not a student submission', async () => {
    const { quiz, student } = await setupQuizWithEnrolledStudent();
    const { attempt_id } = await startAttempt(quiz, student);

    await QuizAttempt.updateOne({ _id: attempt_id }, { expires_at: new Date(Date.now() - 1000) });

    const res = await request(app)
      .post(`/api/v1/quizzes/attempts/${attempt_id}/submit`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(200); // NOT an error here — submit() returns the graded result directly
    expect(res.body.data.attempt.submitted_by).toBe('system_timeout'); // NOT 'student', despite hitting /submit
  });
});
