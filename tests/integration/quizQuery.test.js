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

async function createUserAndLogin({ role = 'Instructor', email = 'instructor@example.com' } = {}) {
  const passwordHash = await hashPassword(PLAIN_PASSWORD);
  const user = await User.create({
    full_name: 'Test User',
    email,
    password_hash: passwordHash,
    birth_date: new Date('1990-01-01'),
    role,
    status: 'active',
    email_verified_at: new Date(),
    kyc_status: 'verified',
    mfa_enabled: true,
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

function baseQuizFields({ course_id, unit_id, instructor_id, overrides = {} }) {
  return {
    course_id,
    unit_id,
    instructor_id,
    quiz_type: 'quiz',
    title: 'Sample Quiz',
    start_time: new Date(Date.now() - 60 * 60 * 1000),
    end_time: new Date(Date.now() + 60 * 60 * 1000),
    duration_minutes: 30,
    passing_score_percent: 60,
    status: 'draft',
    locked: false,
    questions: [
      {
        question_type: 'mcq',
        text: 'Q1?',
        choices: [
          { text: 'A', is_correct: false },
          { text: 'B', is_correct: true },
        ],
      },
    ],
    ...overrides,
  };
}

async function setupCourseAndUnit(instructorId) {
  const course = await Course.create({
    title: 'Course A',
    description: 'desc',
    category: 'Technology & Computer Science',
    course_type: 'free',
    is_synchronous: false,
    owner_instructor_id: instructorId,
    status: 'published',
  });
  const unit = await CourseUnit.create({ course_id: course._id, title: 'Unit 1', order: 1 });
  return { course, unit };
}

describe('GET /api/v1/quizzes/:quizId (Instructor detail — includes is_correct)', () => {
  it('returns the full quiz WITH is_correct for the owner', async () => {
    const { accessToken, user } = await createUserAndLogin();
    const { course, unit } = await setupCourseAndUnit(user._id);
    const quiz = await Quiz.create(
      baseQuizFields({ course_id: course._id, unit_id: unit._id, instructor_id: user._id })
    );

    const res = await request(app)
      .get(`/api/v1/quizzes/${quiz._id}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.quiz.questions[0].choices[0]).toHaveProperty('is_correct');
  });

  it('rejects with 403 for a non-owner instructor', async () => {
    const owner = await createUserAndLogin({ email: 'owner@example.com' });
    const { course, unit } = await setupCourseAndUnit(owner.user._id);
    const quiz = await Quiz.create(
      baseQuizFields({ course_id: course._id, unit_id: unit._id, instructor_id: owner.user._id })
    );
    const stranger = await createUserAndLogin({ email: 'stranger@example.com' });

    const res = await request(app)
      .get(`/api/v1/quizzes/${quiz._id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);

    expect(res.status).toBe(403);
  });
});

describe('GET /api/v1/quizzes (Instructor list — is_correct hidden)', () => {
  it('returns own quizzes WITHOUT is_correct in the list view', async () => {
    const { accessToken, user } = await createUserAndLogin();
    const { course, unit } = await setupCourseAndUnit(user._id);
    await Quiz.create(
      baseQuizFields({ course_id: course._id, unit_id: unit._id, instructor_id: user._id })
    );

    const res = await request(app)
      .get('/api/v1/quizzes')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.quizzes).toHaveLength(1);
    const serialized = JSON.stringify(res.body.data.quizzes);
    expect(serialized).not.toMatch(/is_correct/);
  });

  it('filters by course_id', async () => {
    const { accessToken, user } = await createUserAndLogin();
    const { course: courseA, unit: unitA } = await setupCourseAndUnit(user._id);
    const { course: courseB, unit: unitB } = await setupCourseAndUnit(user._id);
    await Quiz.create(
      baseQuizFields({ course_id: courseA._id, unit_id: unitA._id, instructor_id: user._id })
    );
    await Quiz.create(
      baseQuizFields({ course_id: courseB._id, unit_id: unitB._id, instructor_id: user._id })
    );

    const res = await request(app)
      .get(`/api/v1/quizzes?course_id=${courseA._id}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.body.data.quizzes).toHaveLength(1);
    expect(res.body.data.quizzes[0].course_id.toString()).toBe(courseA._id.toString());
  });
});

describe('DELETE /api/v1/quizzes/:quizId', () => {
  it('deletes a draft quiz owned by the instructor', async () => {
    const { accessToken, user } = await createUserAndLogin();
    const { course, unit } = await setupCourseAndUnit(user._id);
    const quiz = await Quiz.create(
      baseQuizFields({ course_id: course._id, unit_id: unit._id, instructor_id: user._id })
    );

    const res = await request(app)
      .delete(`/api/v1/quizzes/${quiz._id}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    const stillExists = await Quiz.findById(quiz._id);
    expect(stillExists).toBeNull();
  });

  it('rejects with 409 QUIZ_LOCKED once a QuizAttempt exists', async () => {
    const { accessToken, user } = await createUserAndLogin();
    const { course, unit } = await setupCourseAndUnit(user._id);
    const quiz = await Quiz.create(
      baseQuizFields({
        course_id: course._id,
        unit_id: unit._id,
        instructor_id: user._id,
        overrides: { status: 'published', locked: true },
      })
    );

    const res = await request(app)
      .delete(`/api/v1/quizzes/${quiz._id}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUIZ_LOCKED');
    const stillExists = await Quiz.findById(quiz._id);
    expect(stillExists).not.toBeNull();
  });

  it('prevents IDOR: rejects deletion with 403 for a non-owner', async () => {
    const owner = await createUserAndLogin({ email: 'owner2@example.com' });
    const { course, unit } = await setupCourseAndUnit(owner.user._id);
    const quiz = await Quiz.create(
      baseQuizFields({ course_id: course._id, unit_id: unit._id, instructor_id: owner.user._id })
    );
    const stranger = await createUserAndLogin({ email: 'stranger2@example.com' });

    const res = await request(app)
      .delete(`/api/v1/quizzes/${quiz._id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);

    expect(res.status).toBe(403);
    const stillExists = await Quiz.findById(quiz._id);
    expect(stillExists).not.toBeNull();
  });
});

describe('GET /api/v1/quizzes/course/:courseId/available (Student)', () => {
  it('returns only published quizzes, without questions, for an enrolled student', async () => {
    const instructor = await createUserAndLogin({ email: 'inst@example.com' });
    const { course, unit } = await setupCourseAndUnit(instructor.user._id);
    await Quiz.create(
      baseQuizFields({
        course_id: course._id,
        unit_id: unit._id,
        instructor_id: instructor.user._id,
        overrides: { status: 'published' },
      })
    );
    await Quiz.create(
      baseQuizFields({
        course_id: course._id,
        unit_id: unit._id,
        instructor_id: instructor.user._id,
        overrides: { status: 'draft', title: 'Still Draft' },
      })
    );

    const student = await createUserAndLogin({ role: 'Student', email: 'student@example.com' });
    await Enrollment.create({
      course_id: course._id,
      student_id: student.user._id,
      status: 'active',
      confirmed_by_student: true,
    });

    const res = await request(app)
      .get(`/api/v1/quizzes/course/${course._id}/available`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.quizzes).toHaveLength(1); // draft excluded
    expect(res.body.data.quizzes[0].title).toBe('Sample Quiz');
    const serialized = JSON.stringify(res.body.data.quizzes);
    expect(serialized).not.toMatch(/questions/); // list view carries no question content at all
  });

  it('rejects with 403 NOT_ENROLLED for a non-enrolled student', async () => {
    const instructor = await createUserAndLogin({ email: 'inst2@example.com' });
    const { course } = await setupCourseAndUnit(instructor.user._id);
    const student = await createUserAndLogin({ role: 'Student', email: 'student2@example.com' });

    const res = await request(app)
      .get(`/api/v1/quizzes/course/${course._id}/available`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_ENROLLED');
  });
});
