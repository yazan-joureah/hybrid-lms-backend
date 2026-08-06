/**
 * Integration tests for Quiz Management (Instructor facing).
 * Covers POST /quizzes, PUT /quizzes/:quizId, POST /quizzes/:quizId/publish.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const User = require('../../src/models/User');
const Course = require('../../src/models/Course');
const CourseUnit = require('../../src/models/CourseUnit');
const Quiz = require('../../src/models/quiz.model');
const QuizAttempt = require('../../src/models/quizAttempt.model');
const Session = require('../../src/models/Session');
const { hashPassword } = require('../../src/utils/crypto');
const redisClient = require('../../src/config/redis');
const { signAccessToken } = require('../../src/utils/jwt');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
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

async function createInstructorAndLogin(overrides = {}) {
  const passwordHash = await hashPassword(PLAIN_PASSWORD);
  const user = await User.create({
    full_name: overrides.full_name || 'Valid Instructor',
    email: overrides.email || 'quiz.instructor@example.com',
    password_hash: passwordHash,
    birth_date: new Date('1990-01-01'),
    role: 'Instructor',
    status: 'active',
    email_verified_at: new Date(),
    kyc_status: overrides.kyc_status !== undefined ? overrides.kyc_status : 'verified',
    mfa_enabled: overrides.mfa_enabled !== undefined ? overrides.mfa_enabled : true,
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

async function setupCourseWithUnit(instructorId) {
  const course = await Course.create({
    title: 'Cybersecurity Fundamentals',
    description: 'A course about security basics.',
    category: 'Technology & Computer Science',
    course_type: 'free',
    is_synchronous: false,
    owner_instructor_id: instructorId,
    status: 'published',
  });
  const unit = await CourseUnit.create({ course_id: course._id, title: 'Unit 1', order: 1 });
  return { course, unit };
}

const baseQuestion = {
  question_type: 'mcq',
  text: 'What is 2 + 2?',
  choices: [
    { text: '3', is_correct: false },
    { text: '4', is_correct: true },
  ],
};

function buildQuizPayload({ course_id, unit_id }) {
  return {
    course_id: course_id.toString(),
    unit_id: unit_id.toString(),
    quiz_type: 'quiz',
    title: 'Unit 1 Quiz',
    start_time: '2026-08-10T09:00:00.000Z',
    end_time: '2026-08-10T10:00:00.000Z',
    duration_minutes: 30,
    passing_score_percent: 60,
    questions: [baseQuestion],
  };
}

describe('POST /api/v1/quizzes (Create Quiz)', () => {
  it('creates a quiz in draft status, unpublished, when the instructor owns the course and unit', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const { course, unit } = await setupCourseWithUnit(user._id);
    const res = await request(app)
      .post('/api/v1/quizzes')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(buildQuizPayload({ course_id: course._id, unit_id: unit._id }));
    expect(res.status).toBe(201);
    expect(res.body.data.quiz.status).toBe('draft');
    expect(res.body.data.quiz.locked).toBe(false);
    expect(res.body.data.quiz.instructor_id.toString()).toBe(user._id.toString());
  });

  it('rejects with 403 FORBIDDEN if the instructor does not own the course', async () => {
    const instructorA = await createInstructorAndLogin({ email: 'a@example.com' });
    const { course, unit } = await setupCourseWithUnit(instructorA.user._id);
    const instructorB = await createInstructorAndLogin({ email: 'b@example.com' });

    const res = await request(app)
      .post('/api/v1/quizzes')
      .set('Authorization', `Bearer ${instructorB.accessToken}`)
      .send(buildQuizPayload({ course_id: course._id, unit_id: unit._id }));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects with 404 UNIT_NOT_FOUND if unit_id belongs to a DIFFERENT course than course_id', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const { course: courseA } = await setupCourseWithUnit(user._id);
    const { unit: unitFromCourseB } = await setupCourseWithUnit(user._id); // a second, separate course+unit

    const res = await request(app)
      .post('/api/v1/quizzes')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(buildQuizPayload({ course_id: courseA._id, unit_id: unitFromCourseB._id }));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('UNIT_NOT_FOUND');
  });

  it('creates a course-wide exam successfully with unit_id omitted', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const { course } = await setupCourseWithUnit(user._id);
    const { unit_id: _unit_id, ...examPayload } = buildQuizPayload({
      course_id: course._id,
      unit_id: 'placeholder',
    });
    const res = await request(app)
      .post('/api/v1/quizzes')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ...examPayload, quiz_type: 'exam' });

    expect(res.status).toBe(201);
    expect(res.body.data.quiz.quiz_type).toBe('exam');
    expect(res.body.data.quiz.unit_id).toBeFalsy();
  });
});

describe('PUT /api/v1/quizzes/:quizId (Update Quiz)', () => {
  it('updates a draft quiz freely (locked=false)', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const { course, unit } = await setupCourseWithUnit(user._id);
    const quiz = await Quiz.create({
      ...buildQuizPayload({ course_id: course._id, unit_id: unit._id }),
      instructor_id: user._id,
      status: 'draft',
      locked: false,
    });

    const res = await request(app)
      .put(`/api/v1/quizzes/${quiz._id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Updated Quiz Title' });

    expect(res.status).toBe(200);
    expect(res.body.data.quiz.title).toBe('Updated Quiz Title');
  });

  it('prevents IDOR: rejects update with 403 if instructor is not the owner', async () => {
    const instructorA = await createInstructorAndLogin({ email: 'a@example.com' });
    const { course, unit } = await setupCourseWithUnit(instructorA.user._id);
    const quiz = await Quiz.create({
      ...buildQuizPayload({ course_id: course._id, unit_id: unit._id }),
      instructor_id: instructorA.user._id,
      status: 'draft',
      locked: false,
    });
    const instructorB = await createInstructorAndLogin({ email: 'b@example.com' });

    const res = await request(app)
      .put(`/api/v1/quizzes/${quiz._id}`)
      .set('Authorization', `Bearer ${instructorB.accessToken}`)
      .send({ title: 'Hacked Title' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects with 409 QUIZ_LOCKED once a QuizAttempt exists, even for the rightful owner', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const { course, unit } = await setupCourseWithUnit(user._id);
    const quiz = await Quiz.create({
      ...buildQuizPayload({ course_id: course._id, unit_id: unit._id }),
      instructor_id: user._id,
      status: 'published',
      locked: true, // simulates: a student has already started an attempt
    });

    const res = await request(app)
      .put(`/api/v1/quizzes/${quiz._id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Should Not Save' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUIZ_LOCKED');

    const unchanged = await Quiz.findById(quiz._id);
    expect(unchanged.title).toBe(quiz.title); // confirms no partial write happened
  });

  it('allows updating a PUBLISHED quiz as long as it is not locked', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const { course, unit } = await setupCourseWithUnit(user._id);
    const quiz = await Quiz.create({
      ...buildQuizPayload({ course_id: course._id, unit_id: unit._id }),
      instructor_id: user._id,
      status: 'published',
      locked: false,
    });

    const res = await request(app)
      .put(`/api/v1/quizzes/${quiz._id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ passing_score_percent: 75 });

    expect(res.status).toBe(200);
    expect(res.body.data.quiz.status).toBe('published'); // unaffected by the edit
    expect(res.body.data.quiz.passing_score_percent).toBe(75);
  });
});

describe('POST /api/v1/quizzes/:quizId/publish (Publish Quiz)', () => {
  it('transitions a draft quiz to published', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const { course, unit } = await setupCourseWithUnit(user._id);
    const quiz = await Quiz.create({
      ...buildQuizPayload({ course_id: course._id, unit_id: unit._id }),
      instructor_id: user._id,
      status: 'draft',
      locked: false,
    });

    const res = await request(app)
      .post(`/api/v1/quizzes/${quiz._id}/publish`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.quiz.status).toBe('published');
  });

  it('rejects with 400 ALREADY_PUBLISHED if called twice', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const { course, unit } = await setupCourseWithUnit(user._id);
    const quiz = await Quiz.create({
      ...buildQuizPayload({ course_id: course._id, unit_id: unit._id }),
      instructor_id: user._id,
      status: 'published',
      locked: false,
    });

    const res = await request(app)
      .post(`/api/v1/quizzes/${quiz._id}/publish`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ALREADY_PUBLISHED');
  });

  it('rejects with 403 FORBIDDEN if instructor is not the owner', async () => {
    const instructorA = await createInstructorAndLogin({ email: 'a@example.com' });
    const { course, unit } = await setupCourseWithUnit(instructorA.user._id);
    const quiz = await Quiz.create({
      ...buildQuizPayload({ course_id: course._id, unit_id: unit._id }),
      instructor_id: instructorA.user._id,
      status: 'draft',
      locked: false,
    });
    const instructorB = await createInstructorAndLogin({ email: 'b@example.com' });

    const res = await request(app)
      .post(`/api/v1/quizzes/${quiz._id}/publish`)
      .set('Authorization', `Bearer ${instructorB.accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('Mongoose Schema integrity (exercised implicitly through the API — no separate model test file, per project convention)', () => {
  it('rejects a quiz with end_time before start_time at the DB layer too (defense-in-depth beyond Zod)', async () => {
    const { user } = await createInstructorAndLogin();
    const { course, unit } = await setupCourseWithUnit(user._id);
    // Bypasses the Zod layer entirely by writing directly with .create(),
    // proving the Mongoose pre('validate') hook is a REAL second gate,
    // not just documentation.
    await expect(
      Quiz.create({
        ...buildQuizPayload({ course_id: course._id, unit_id: unit._id }),
        instructor_id: user._id,
        end_time: '2026-08-10T08:00:00.000Z', // before start_time
      })
    ).rejects.toThrow(/end_time must be after start_time/);
  });

  it('rejects quiz_type="exam" with a non-null unit_id at the DB layer too', async () => {
    const { user } = await createInstructorAndLogin();
    const { course, unit } = await setupCourseWithUnit(user._id);

    await expect(
      Quiz.create({
        ...buildQuizPayload({ course_id: course._id, unit_id: unit._id }),
        instructor_id: user._id,
        quiz_type: 'exam', // unit_id still set from buildQuizPayload — should be rejected
      })
    ).rejects.toThrow(/unit_id must not be set/);
  });
});
