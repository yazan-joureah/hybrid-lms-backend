// quizResumeAndAdmin.test.js
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

async function setupQuizWithEnrolledStudent() {
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
    duration_minutes: 30,
    passing_score_percent: 50,
    max_attempts: 2,
    status: 'published',
    locked: false,
    questions: [
      {
        question_type: 'mcq',
        text: 'Q1',
        choices: [
          { text: 'Wrong', is_correct: false },
          { text: 'Right', is_correct: true },
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

describe('GET /api/v1/quizzes/attempts/:attemptId (Resume)', () => {
  it('returns the in-progress attempt with sanitized quiz and previous answers', async () => {
    const { quiz, student } = await setupQuizWithEnrolledStudent();
    const start = await request(app)
      .post(`/api/v1/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.accessToken}`);
    const { attempt_id } = start.body.data;

    const res = await request(app)
      .get(`/api/v1/quizzes/attempts/${attempt_id}`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.attempt_id).toBe(attempt_id);
    expect(res.body.data.previous_answers).toEqual([]);
    expect(JSON.stringify(res.body.data.quiz)).not.toMatch(/is_correct/);
  });

  it("rejects with 404 ATTEMPT_NOT_FOUND for another student's attempt (IDOR guard)", async () => {
    const { quiz, student } = await setupQuizWithEnrolledStudent();
    const start = await request(app)
      .post(`/api/v1/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.accessToken}`);
    const { attempt_id } = start.body.data;

    const stranger = await createUserAndLogin({ email: 'stranger@example.com' });
    const res = await request(app)
      .get(`/api/v1/quizzes/attempts/${attempt_id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ATTEMPT_NOT_FOUND');
  });

  it('rejects with 409 ATTEMPT_NOT_IN_PROGRESS after the attempt has been submitted', async () => {
    const { quiz, student } = await setupQuizWithEnrolledStudent();
    const start = await request(app)
      .post(`/api/v1/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.accessToken}`);
    const { attempt_id } = start.body.data;

    await request(app)
      .post(`/api/v1/quizzes/attempts/${attempt_id}/submit`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    const res = await request(app)
      .get(`/api/v1/quizzes/attempts/${attempt_id}`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ATTEMPT_NOT_IN_PROGRESS');
  });
});

describe('GET /api/v1/quizzes/:quizId/current-attempt', () => {
  it('returns null when the student has no active attempt', async () => {
    const { quiz, student } = await setupQuizWithEnrolledStudent();
    const res = await request(app)
      .get(`/api/v1/quizzes/${quiz._id}/current-attempt`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('returns the active attempt once one has been started', async () => {
    const { quiz, student } = await setupQuizWithEnrolledStudent();
    const start = await request(app)
      .post(`/api/v1/quizzes/${quiz._id}/start`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    const res = await request(app)
      .get(`/api/v1/quizzes/${quiz._id}/current-attempt`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.attempt_id).toBe(start.body.data.attempt_id);
  });
});

describe('GET /api/v1/quizzes/admin/course/:courseId (Admin review)', () => {
  it("lets an Admin see the course's quizzes without is_correct", async () => {
    const { course } = await setupQuizWithEnrolledStudent();
    const admin = await createUserAndLogin({ role: 'Admin', email: 'admin@example.com' });

    const res = await request(app)
      .get(`/api/v1/quizzes/admin/course/${course._id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.quizzes).toHaveLength(1);
    expect(JSON.stringify(res.body.data.quizzes)).not.toMatch(/is_correct/);
  });

  it('rejects with 403 for a non-admin (e.g. Instructor)', async () => {
    const { course, instructor } = await setupQuizWithEnrolledStudent();
    const res = await request(app)
      .get(`/api/v1/quizzes/admin/course/${course._id}`)
      .set('Authorization', `Bearer ${instructor.accessToken}`);

    expect(res.status).toBe(403);
  });

  it('returns an empty list (not an error) for a course with no quizzes', async () => {
    const admin = await createUserAndLogin({ role: 'Admin', email: 'admin2@example.com' });
    const emptyCourseId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .get(`/api/v1/quizzes/admin/course/${emptyCourseId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.quizzes).toEqual([]);
  });
});
