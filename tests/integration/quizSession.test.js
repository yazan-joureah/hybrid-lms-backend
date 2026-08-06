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

async function setupPublishedQuizWithEnrolledStudent(overrides = {}) {
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
    start_time: overrides.start_time || new Date(Date.now() - 60 * 60 * 1000),
    end_time: overrides.end_time || new Date(Date.now() + 60 * 60 * 1000),
    duration_minutes: 30,
    passing_score_percent: 60,
    max_attempts: overrides.max_attempts || 2,
    status: overrides.status || 'published',
    locked: false,
    questions: [
      {
        question_type: 'mcq',
        text: 'What is 2 + 2?',
        choices: [
          { text: '3', is_correct: false },
          { text: '4', is_correct: true },
        ],
      },
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

  const student = await createUserAndLogin({ role: 'Student', email: 'student@example.com' });
  if (!overrides.skipEnrollment) {
    await Enrollment.create({
      course_id: course._id,
      student_id: student.user._id,
      status: 'active',
      confirmed_by_student: true,
    });
  }

  return { instructor, course, unit, quiz, student };
}

describe('POST /api/v1/quizzes/:quizId/start (UC-QUIZ-02)', () => {
  it('starts an attempt, locks the quiz, and returns a sanitized quiz WITHOUT is_correct', async () => {
    const { quiz, student } = await setupPublishedQuizWithEnrolledStudent();

    const res = await request(app)
      .post(`/api/v1/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(201);
    expect(res.body.data.attempt_id).toBeTruthy();
    expect(res.body.data.expires_at).toBeTruthy();

    // The core security guarantee — no leak, at any depth of the response.
    const serialized = JSON.stringify(res.body.data.quiz);
    expect(serialized).not.toMatch(/is_correct/);

    expect(res.body.data.quiz.questions).toHaveLength(2);

    const updatedQuiz = await Quiz.findById(quiz._id);
    expect(updatedQuiz.locked).toBe(true);

    const attempt = await QuizAttempt.findById(res.body.data.attempt_id);
    expect(attempt.status).toBe('in_progress');
    expect(attempt.attempt_number).toBe(1);
    expect(attempt.shuffled_question_order).toHaveLength(2);
  });

  it('rejects with 403 NOT_ENROLLED for a student not enrolled in the course', async () => {
    const { quiz } = await setupPublishedQuizWithEnrolledStudent({ skipEnrollment: true });
    const { accessToken } = await createUserAndLogin({ email: 'stranger@example.com' });

    const res = await request(app)
      .post(`/api/v1/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_ENROLLED');
  });

  it('rejects with 404 QUIZ_NOT_FOUND for a draft quiz (prevents confirming its existence)', async () => {
    const { quiz, student } = await setupPublishedQuizWithEnrolledStudent({ status: 'draft' }); // CHANGED: destructure student directly

    const res = await request(app)
      .post(`/api/v1/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.accessToken}`); // CHANGED: reuse the returned token

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('QUIZ_NOT_FOUND');
  });

  it('rejects with 400 QUIZ_WINDOW_CLOSED before start_time', async () => {
    const { quiz, student } = await setupPublishedQuizWithEnrolledStudent({
      start_time: new Date(Date.now() + 60 * 60 * 1000),
      end_time: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });

    const res = await request(app)
      .post(`/api/v1/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('QUIZ_WINDOW_CLOSED');
  });

  it('rejects with 403 ATTEMPTS_EXHAUSTED once max_attempts is reached', async () => {
    const { quiz, student } = await setupPublishedQuizWithEnrolledStudent({ max_attempts: 1 });

    const first = await request(app)
      .post(`/api/v1/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.accessToken}`);
    expect(first.status).toBe(201);

    // Mark the first attempt as submitted so the second call doesn't collide
    // with the in-progress unique index — we're testing the ATTEMPTS
    // counter specifically, not the concurrent-attempt guard below.
    await QuizAttempt.updateOne({ _id: first.body.data.attempt_id }, { status: 'submitted' });

    const second = await request(app)
      .post(`/api/v1/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(second.status).toBe(403);
    expect(second.body.error.code).toBe('ATTEMPTS_EXHAUSTED');
  });

  it('rejects with 409 ATTEMPT_IN_PROGRESS on a concurrent second start (partial unique index)', async () => {
    const { quiz, student } = await setupPublishedQuizWithEnrolledStudent({ max_attempts: 5 });

    const first = await request(app)
      .post(`/api/v1/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.accessToken}`);
    expect(first.status).toBe(201);

    // Second call WITHOUT submitting the first — must be blocked by the
    // partial unique index (quiz_id, student_id, status='in_progress').
    const second = await request(app)
      .post(`/api/v1/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ATTEMPT_IN_PROGRESS');

    const attemptsCount = await QuizAttempt.countDocuments({ quiz_id: quiz._id });
    expect(attemptsCount).toBe(1); // confirms no second document was created
  });

  it('does NOT re-lock or error when starting a SECOND quiz on an already-locked quiz (locked stays true, idempotent)', async () => {
    const { quiz, student } = await setupPublishedQuizWithEnrolledStudent({ max_attempts: 3 });

    await request(app)
      .post(`/api/v1/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    await QuizAttempt.updateMany({ quiz_id: quiz._id }, { status: 'submitted' });

    const secondAttempt = await request(app)
      .post(`/api/v1/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(secondAttempt.status).toBe(201);
    const finalQuiz = await Quiz.findById(quiz._id);
    expect(finalQuiz.locked).toBe(true); // unchanged, no error thrown re-setting it
  });
});
