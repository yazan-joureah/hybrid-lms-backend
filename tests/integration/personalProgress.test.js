/**
 * Integration tests for UC-REPORT-03: Personal Progress Summary
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const User = require('../../src/models/User');
const Course = require('../../src/models/Course');
const Enrollment = require('../../src/models/Enrollment');
const Session = require('../../src/models/Session');
const LiveSession = require('../../src/models/liveSession.model');
const Attendance = require('../../src/models/attendance.model');
const Quiz = require('../../src/models/quiz.model');
const QuizAttempt = require('../../src/models/quizAttempt.model');
const { hashPassword } = require('../../src/utils/crypto');
const redisClient = require('../../src/config/redis');
const { signAccessToken } = require('../../src/utils/jwt');

const PLAIN_PASSWORD = 'password2026';

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI);
  }
}, 20000);

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Course.deleteMany({}),
    Enrollment.deleteMany({}),
    Session.deleteMany({}),
    LiveSession.deleteMany({}),
    Attendance.deleteMany({}),
    Quiz.deleteMany({}),
    QuizAttempt.deleteMany({}),
  ]);
  if (redisClient.isOpen) await redisClient.flushdb();
});

afterAll(async () => {
  await mongoose.connection.close();
  await redisClient.quit();
});

async function createUserAndLogin(overrides = {}) {
  const passwordHash = await hashPassword(PLAIN_PASSWORD);
  // privacy_consent_version required per authSchemas[cite: 12]
  const user = await User.create({
    full_name: 'Progress Test User',
    email: overrides.email || `test-${Date.now()}@example.com`,
    password_hash: passwordHash,
    birth_date: new Date('2000-01-01'),
    role: overrides.role || 'Student',
    status: 'active',
    kyc_status: overrides.kyc_status || 'not_submitted',
    mfa_enabled: overrides.mfa_enabled || false,
    privacy_consent_version: 'v1.0',
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

describe('GET /api/v1/report/me — Access Control', () => {
  it('returns 401 for unauthenticated requests', async () => {
    const res = await request(app).get('/api/v1/report/me');
    expect(res.status).toBe(401);
  });

  it('returns 403 FORBIDDEN for Instructors (Student-only route)', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const res = await request(app)
      .get('/api/v1/report/me')
      .set('Authorization', `Bearer ${instructor.accessToken}`);

    expect(res.status).toBe(403);
  });

  it('SUCCEEDS (200) for Students even without KYC or MFA', async () => {
    const student = await createUserAndLogin({ kyc_status: 'not_submitted', mfa_enabled: false });
    const res = await request(app)
      .get('/api/v1/report/me')
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.overallAttendancePercentage).toBeNull();
  });
});

describe('GET /api/v1/report/me — Data Aggregation', () => {
  it('aggregates cross-course progress, recent quizzes, and overall attendance accurately', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();

    // course_type and category matched to courseSchemas_2
    const course1 = await Course.create({
      title: 'Course 1',
      description: 'Test description',
      course_type: 'free',
      owner_instructor_id: instructor.user._id,
      category: 'Technology & Computer Science',
      status: 'published',
    });
    await Enrollment.create({
      course_id: course1._id,
      student_id: student.user._id,
      status: 'active',
      confirmed_by_student: true,
    });

    const course2 = await Course.create({
      title: 'Course 2',
      description: 'Test description',
      course_type: 'free',
      owner_instructor_id: instructor.user._id,
      category: 'Technology & Computer Science',
      status: 'published',
    });
    await Enrollment.create({
      course_id: course2._id,
      student_id: student.user._id,
      status: 'completed',
      confirmed_by_student: true,
    });

    // Duration, passing score, and 'exam' type (to bypass unit_id requirement) matched to quizSchemas[cite: 18]
    const quiz1 = await Quiz.create({
      course_id: course1._id,
      title: 'Q1',
      instructor_id: instructor.user._id,
      quiz_type: 'exam',
      duration_minutes: 30,
      passing_score_percent: 50,
      questions: [
        {
          question_type: 'mcq',
          text: 'Sample',
          choices: [
            { text: 'A', is_correct: true },
            { text: 'B', is_correct: false },
          ],
        },
      ],
    });

    await QuizAttempt.create({
      quiz_id: quiz1._id,
      student_id: student.user._id,
      status: 'graded',
      score_percent: 85,
      passed: true,
      graded_at: new Date(),
      attempt_number: 1, // <-- Added
      expires_at: new Date(Date.now() + 60 * 60 * 1000), // <-- Added
    });

    // Title matched to liveSchemas[cite: 15]
    // Live Sessions across both courses
    const session1 = await LiveSession.create({
      courseId: course1._id,
      instructorId: instructor.user._id, // <-- Added
      meetingLink: 'https://example.com/live-1', // <-- Added
      title: 'S1',
      status: 'ended',
      startTime: new Date(),
      endTime: new Date(),
    });
    await Attendance.create({
      sessionId: session1._id,
      courseId: course1._id,
      studentId: student.user._id,
      status: 'present',
      joinedAt: new Date(), // <-- Added
    });
    const session2 = await LiveSession.create({
      courseId: course2._id,
      instructorId: instructor.user._id, // <-- Added
      meetingLink: 'https://example.com/live-2', // <-- Added
      title: 'S2',
      status: 'ended',
      startTime: new Date(),
      endTime: new Date(),
    });
    await Attendance.create({
      sessionId: session2._id,
      courseId: course2._id,
      studentId: student.user._id,
      status: 'absent',
      joinedAt: new Date(), // <-- Added
    });
    const res = await request(app)
      .get('/api/v1/report/me')
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.courses).toHaveLength(2);
    expect(res.body.data.overallAttendancePercentage).toBe(0.5);
    expect(res.body.data.latestQuizResults).toHaveLength(1);
  });
});
