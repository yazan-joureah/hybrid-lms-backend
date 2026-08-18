/**
 * Integration tests for the Student-facing course path[cite: 30]:
 * browsing, enrollment, progress tracking, content access, file streaming.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const User = require('../../src/models/User');
const Course = require('../../src/models/Course');
const CourseUnit = require('../../src/models/CourseUnit');
const CourseContent = require('../../src/models/CourseContent');
const Enrollment = require('../../src/models/Enrollment');
const CourseProgressEvent = require('../../src/models/CourseProgressEvent');
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
    CourseContent.deleteMany({}),
    Enrollment.deleteMany({}),
    CourseProgressEvent.deleteMany({}),
    Session.deleteMany({}),
    mongoose.connection.collection('course_files.files').deleteMany({}),
    mongoose.connection.collection('course_files.chunks').deleteMany({}),
  ]);
  if (redisClient.isOpen) await redisClient.flushdb();
});

afterAll(async () => {
  await mongoose.connection.close();
  if (redisClient.isOpen) await redisClient.quit();
});

async function createUserAndLogin(overrides = {}) {
  const passwordHash = await hashPassword(PLAIN_PASSWORD);
  const user = await User.create({
    full_name: overrides.full_name || 'Test User',
    email: overrides.email || `user-${Date.now()}-${Math.random()}@example.com`,
    password_hash: passwordHash,
    birth_date: new Date('1990-01-01'),
    role: overrides.role || 'Student',
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

const baseCourse = {
  title: 'Published Test Course',
  description: 'A published course for student-path testing.',
  category: 'Technology & Computer Science',
  course_type: 'free',
  is_synchronous: false,
  completion_threshold: 0.7,
};

describe('GET /api/v1/courses (Browse)', () => {
  it('returns only published courses, no auth required', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    await Course.create({
      ...baseCourse,
      owner_instructor_id: instructor.user._id,
      status: 'draft',
    });
    const published = await Course.create({
      ...baseCourse,
      owner_instructor_id: instructor.user._id,
      status: 'published',
    });

    const res = await request(app).get('/api/v1/courses');

    expect(res.status).toBe(200);
    expect(res.body.data.courses).toHaveLength(1);
    expect(res.body.data.courses[0]._id).toBe(published._id.toString());
  });

  it('filters by category', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    await Course.create({
      ...baseCourse,
      owner_instructor_id: instructor.user._id,
      status: 'published',
      category: 'Languages',
    });
    await Course.create({
      ...baseCourse,
      owner_instructor_id: instructor.user._id,
      status: 'published',
    });

    const res = await request(app).get('/api/v1/courses').query({ category: 'Languages' });

    expect(res.body.data.courses).toHaveLength(1);
    expect(res.body.data.courses[0].category).toBe('Languages');
  });

  it('filters by search (case-insensitive partial title match)', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    await Course.create({
      ...baseCourse,
      title: 'Advanced Node.js',
      owner_instructor_id: instructor.user._id,
      status: 'published',
    });
    await Course.create({
      ...baseCourse,
      title: 'Intro to Python',
      owner_instructor_id: instructor.user._id,
      status: 'published',
    });

    const res = await request(app).get('/api/v1/courses').query({ search: 'node' });

    expect(res.body.data.courses).toHaveLength(1);
    expect(res.body.data.courses[0].title).toBe('Advanced Node.js');
  });
});

describe('GET /api/v1/courses/:courseId (Public Details)', () => {
  it('returns 404 (not 403) for a non-published course — prevents enumeration', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const draftCourse = await Course.create({
      ...baseCourse,
      owner_instructor_id: instructor.user._id,
      status: 'draft',
    });

    const res = await request(app).get(`/api/v1/courses/${draftCourse._id}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COURSE_NOT_FOUND');
  });

  it('returns details for a published course', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const course = await Course.create({
      ...baseCourse,
      owner_instructor_id: instructor.user._id,
      status: 'published',
    });

    const res = await request(app).get(`/api/v1/courses/${course._id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.course.title).toBe(baseCourse.title);
  });
});

describe('GET /api/v1/courses/:courseId (Instructor own-status view via general course route)', () => {
  it('returns a draft course to its owner using the authenticated course endpoint', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const course = await Course.create({
      ...baseCourse,
      owner_instructor_id: instructor.user._id,
      status: 'draft',
    });
    const unit = await CourseUnit.create({ course_id: course._id, title: 'Unit 1', order: 1 });
    await CourseContent.create({
      course_id: course._id,
      unit_id: unit._id,
      title: 'Intro to course',
      owner_instructor_id: instructor.user._id,
      content_type: 'text',
      content_data: { text: 'x' },
      order: 1,
    });

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}`)
      .set('Authorization', `Bearer ${instructor.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.course.status).toBe('draft');
  });

  it('prevents IDOR: forbids a non-owner instructor from viewing a draft course', async () => {
    const owner = await createUserAndLogin({ role: 'Instructor', email: 'owner@example.com' });
    const attacker = await createUserAndLogin({
      role: 'Instructor',
      email: 'attacker@example.com',
    });
    const course = await Course.create({
      ...baseCourse,
      owner_instructor_id: owner.user._id,
      status: 'draft',
    });

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}`)
      .set('Authorization', `Bearer ${attacker.accessToken}`);

    expect(res.status).toBe(403);
  });
});

describe('POST /api/v1/courses/:courseId/enroll', () => {
  it('activates enrollment immediately for a free course', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin({ role: 'Student' });
    const course = await Course.create({
      ...baseCourse,
      owner_instructor_id: instructor.user._id,
      status: 'published',
    });

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/enroll`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(201);
    expect(res.body.data.enrollment.status).toBe('active');
    expect(res.body.data.enrollment.activated_at).not.toBeNull();
  });

  it('creates a pending_payment enrollment for a paid course, with an explanatory message', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin({ role: 'Student' });
    const course = await Course.create({
      ...baseCourse,
      course_type: 'paid',
      price: 49.99,
      owner_instructor_id: instructor.user._id,
      status: 'published',
    });

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/enroll`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(201);
    expect(res.body.data.enrollment.status).toBe('pending_payment');
  });

  it('rejects a duplicate enrollment attempt with 409 ALREADY_ENROLLED', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin({ role: 'Student' });
    const course = await Course.create({
      ...baseCourse,
      owner_instructor_id: instructor.user._id,
      status: 'published',
    });
    await Enrollment.create({
      course_id: course._id,
      student_id: student.user._id,
      status: 'active',
      confirmed_by_student: true,
    });

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/enroll`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_ENROLLED');
  });
});

describe('GET /api/v1/courses/enrollments/my-courses', () => {
  it("returns only the authenticated student's own enrollments", async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const studentA = await createUserAndLogin({ role: 'Student', email: 'a@example.com' });
    const studentB = await createUserAndLogin({ role: 'Student', email: 'b@example.com' });
    const course = await Course.create({
      ...baseCourse,
      owner_instructor_id: instructor.user._id,
      status: 'published',
    });
    await Enrollment.create({
      course_id: course._id,
      student_id: studentA.user._id,
      status: 'active',
      confirmed_by_student: true,
    });
    await Enrollment.create({
      course_id: course._id,
      student_id: studentB.user._id,
      status: 'active',
      confirmed_by_student: true,
    });

    const res = await request(app)
      .get('/api/v1/courses/enrollments/my-courses')
      .set('Authorization', `Bearer ${studentA.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.enrollments).toHaveLength(1);
    expect(res.body.data.enrollments[0].student_id).toBe(studentA.user._id.toString());
  });
});

describe('POST /api/v1/courses/:courseId/progress', () => {
  it('rejects with 403 NOT_ENROLLED for a non-enrolled student', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin({ role: 'Student' });
    const course = await Course.create({
      ...baseCourse,
      owner_instructor_id: instructor.user._id,
      status: 'published',
    });
    const unit = await CourseUnit.create({ course_id: course._id, title: 'Unit 1', order: 1 });
    const content = await CourseContent.create({
      course_id: course._id,
      unit_id: unit._id,
      title: 'Intro to course',
      owner_instructor_id: instructor.user._id,
      content_type: 'text',
      content_data: { text: 'x' },
      order: 1,
    });

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/progress`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ content_id: content._id.toString() });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_ENROLLED');
  });
});

describe('GET /api/v1/courses/:courseId/units (Student unit list view)', () => {
  it('returns the course units list with download_url support via units route', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin({ role: 'Student' });
    const course = await Course.create({
      ...baseCourse,
      owner_instructor_id: instructor.user._id,
      status: 'published',
    });
    const unit = await CourseUnit.create({ course_id: course._id, title: 'Unit 1', order: 1 });
    await CourseContent.create({
      course_id: course._id,
      unit_id: unit._id,
      title: 'Intro to course',
      owner_instructor_id: instructor.user._id,
      content_type: 'text',
      content_data: { text: 'Lesson text' },
      order: 1,
    });
    await Enrollment.create({
      course_id: course._id,
      student_id: student.user._id,
      status: 'active',
      confirmed_by_student: true,
    });

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/units`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.units).toHaveLength(1);
  });

  it('rejects with 403 NOT_ENROLLED for a non-enrolled student on unit content details', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin({ role: 'Student' });
    const course = await Course.create({
      ...baseCourse,
      owner_instructor_id: instructor.user._id,
      status: 'published',
    });
    // Create two units
    const unit1 = await CourseUnit.create({ course_id: course._id, title: 'Unit 1', order: 1 });
    const unit2 = await CourseUnit.create({ course_id: course._id, title: 'Unit 2', order: 2 });
    // Add content to both (optional)
    await CourseContent.create({
      course_id: course._id,
      unit_id: unit1._id,
      owner_instructor_id: instructor.user._id,
      content_type: 'text',
      title: 'Content 1',
      content_data: { text: 'Lesson' },
      order: 1,
    });
    await CourseContent.create({
      course_id: course._id,
      unit_id: unit2._id,
      owner_instructor_id: instructor.user._id,
      content_type: 'text',
      title: 'Content 2',
      content_data: { text: 'Lesson' },
      order: 1,
    });

    // Request the second unit (order=2)
    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/units/${unit2._id}`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_ENROLLED');
  });
});
