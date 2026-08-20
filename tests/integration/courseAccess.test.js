/**
 * Integration tests for the unified 3-tier course access pattern:
 * GET /:courseId (course info) → GET /:courseId/units (list) →
 * GET /:courseId/units/:unitId (detail + preview rule).
 * Covers Guest/Student/Instructor/Admin role branching in one place,
 * since all four now share the same getCourseForUser/listUnitsForUser/
 * getUnitDetails functions.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const User = require('../../src/models/User');
const Course = require('../../src/models/Course');
const CourseUnit = require('../../src/models/CourseUnit');
const CourseContent = require('../../src/models/CourseContent');
const Enrollment = require('../../src/models/Enrollment');
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
    CourseContent.deleteMany({}),
    Enrollment.deleteMany({}),
    Session.deleteMany({}),
  ]);
  if (redisClient.isOpen) await redisClient.flushdb();
});

afterAll(async () => {
  await mongoose.connection.close();
  await redisClient.quit();
});

async function createUserAndLogin({ role, email }) {
  const passwordHash = await hashPassword(PLAIN_PASSWORD);
  const user = await User.create({
    full_name: 'Test User',
    email,
    password_hash: passwordHash,
    birth_date: new Date('1990-01-01'),
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
    device_fingerprint: 'test',
    ip_address: '127.0.0.1',
    user_agent: 'jest',
    mfa_verified: false,
    status: 'active',
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  const accessToken = signAccessToken({ userId: user._id, sessionId: session._id });
  return { accessToken, user };
}

async function setupCourseWithTwoUnits({ status = 'published' } = {}) {
  const instructor = await createUserAndLogin({
    role: 'Instructor',
    email: 'instructor@example.com',
  });
  const course = await Course.create({
    title: 'Cybersecurity 101',
    description: 'desc',
    category: 'Technology & Computer Science',
    course_type: 'free',
    is_synchronous: false,
    owner_instructor_id: instructor.user._id,
    status,
  });
  const unit1 = await CourseUnit.create({
    course_id: course._id,
    title: 'Unit 1: Intro',
    desc: 'intro',
    order: 1,
  });
  const unit2 = await CourseUnit.create({
    course_id: course._id,
    title: 'Unit 2: Advanced',
    desc: 'advanced',
    order: 2,
  });
  await CourseContent.create({
    course_id: course._id,
    unit_id: unit1._id,
    owner_instructor_id: instructor.user._id,
    content_type: 'text',
    title: 'Welcome',
    desc: '',
    content_data: { text: 'hello' },
    order: 1,
  });
  return { instructor, course, unit1, unit2 };
}

// ============================================================
// GET /:courseId — getCourseForUser
// ============================================================
describe('GET /api/v1/courses/:courseId (unified course read)', () => {
  it('Guest (no token) sees a PUBLISHED course', async () => {
    const { course } = await setupCourseWithTwoUnits({ status: 'published' });
    const res = await request(app).get(`/api/v1/courses/${course._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.course.title).toBe('Cybersecurity 101');
  });

  it('Guest gets 404 (not 403) for a DRAFT course — no existence leak', async () => {
    const { course } = await setupCourseWithTwoUnits({ status: 'draft' });
    const res = await request(app).get(`/api/v1/courses/${course._id}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COURSE_NOT_FOUND');
  });

  it('owning Instructor sees the course even in DRAFT status', async () => {
    const { instructor, course } = await setupCourseWithTwoUnits({ status: 'draft' });
    const res = await request(app)
      .get(`/api/v1/courses/${course._id}`)
      .set('Authorization', `Bearer ${instructor.accessToken}`);
    expect(res.status).toBe(200);
  });

  it('non-owning Instructor gets 403 for a DRAFT course', async () => {
    const { course } = await setupCourseWithTwoUnits({ status: 'draft' });
    const stranger = await createUserAndLogin({
      role: 'Instructor',
      email: 'stranger@example.com',
    });
    const res = await request(app)
      .get(`/api/v1/courses/${course._id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('Admin sees a DRAFT course unrestricted', async () => {
    const { course } = await setupCourseWithTwoUnits({ status: 'draft' });
    const admin = await createUserAndLogin({ role: 'Admin', email: 'admin@example.com' });
    const res = await request(app)
      .get(`/api/v1/courses/${course._id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(200);
  });
});

// ============================================================
// GET /:courseId/units — listUnitsForUser
// ============================================================
describe('GET /api/v1/courses/:courseId/units (lightweight list, no content)', () => {
  it('Guest sees unit titles for a published course, without content items', async () => {
    const { course } = await setupCourseWithTwoUnits();
    const res = await request(app).get(`/api/v1/courses/${course._id}/units`);
    expect(res.status).toBe(200);
    expect(res.body.data.units).toHaveLength(2);
    expect(res.body.data.units[0]).not.toHaveProperty('content');
    expect(res.body.data.units[0].title).toBe('Unit 1: Intro');
  });

  it('rejects with 404 for a draft course viewed by a guest', async () => {
    const { course } = await setupCourseWithTwoUnits({ status: 'draft' });
    const res = await request(app).get(`/api/v1/courses/${course._id}/units`);
    expect(res.status).toBe(404);
  });
});

// ============================================================
// GET /:courseId/units/:unitId — getUnitDetails (PREVIEW RULE)
// ============================================================
describe('GET /api/v1/courses/:courseId/units/:unitId (detail + preview rule)', () => {
  it('Guest CAN open unit order=1 (quality preview before enrolling)', async () => {
    const { course, unit1 } = await setupCourseWithTwoUnits();
    const res = await request(app).get(`/api/v1/courses/${course._id}/units/${unit1._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.unit.content).toHaveLength(1);
    expect(res.body.data.is_preview).toBe(true);
    expect(res.body.data.unit.content[0]).not.toHaveProperty('completed'); // not enrolled
  });

  it('Guest CANNOT open unit order=2 — 403 NOT_ENROLLED', async () => {
    const { course, unit2 } = await setupCourseWithTwoUnits();
    const res = await request(app).get(`/api/v1/courses/${course._id}/units/${unit2._id}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_ENROLLED');
  });

  it('a logged-in but NON-ENROLLED Student also only gets unit order=1', async () => {
    const { course, unit2 } = await setupCourseWithTwoUnits();
    const student = await createUserAndLogin({ role: 'Student', email: 'student@example.com' });
    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/units/${unit2._id}`)
      .set('Authorization', `Bearer ${student.accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_ENROLLED');
  });

  it('an ENROLLED Student can open unit order=2, sees completed + navigation, is_preview=false', async () => {
    const { course, unit2 } = await setupCourseWithTwoUnits();
    const student = await createUserAndLogin({ role: 'Student', email: 'student2@example.com' });
    await Enrollment.create({
      course_id: course._id,
      student_id: student.user._id,
      status: 'active',
      confirmed_by_student: true,
    });

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/units/${unit2._id}`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.is_preview).toBe(false);
    expect(res.body.data.unit.previous_unit.title).toBe('Unit 1: Intro');
    expect(res.body.data.course.title).toBe('Cybersecurity 101');
  });

  it('owning Instructor can open any unit of their own DRAFT course', async () => {
    const { instructor, course, unit2 } = await setupCourseWithTwoUnits({ status: 'draft' });
    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/units/${unit2._id}`)
      .set('Authorization', `Bearer ${instructor.accessToken}`);
    expect(res.status).toBe(200);
  });

  it('non-owning Instructor gets 403 FORBIDDEN (not NOT_ENROLLED — different error for staff)', async () => {
    const { course, unit1 } = await setupCourseWithTwoUnits();
    const stranger = await createUserAndLogin({
      role: 'Instructor',
      email: 'stranger2@example.com',
    });
    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/units/${unit1._id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('Admin can open any unit of any course, unrestricted, regardless of status', async () => {
    const { course, unit2 } = await setupCourseWithTwoUnits({ status: 'draft' });
    const admin = await createUserAndLogin({ role: 'SuperAdmin', email: 'superadmin@example.com' });
    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/units/${unit2._id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(200);
  });
});

// ============================================================
// GET /:courseId/content/:contentId/file — unified streamContentFile
// (regression guard for the previously-broken Admin path)
// ============================================================
describe('GET /api/v1/courses/:courseId/content/:contentId/file (unified streaming)', () => {
  it('rejects with 401 for a fully anonymous guest (file streaming requires auth, unlike unit preview)', async () => {
    const { course, unit1 } = await setupCourseWithTwoUnits();
    const content = await CourseContent.findOne({ unit_id: unit1._id });
    const res = await request(app).get(`/api/v1/courses/${course._id}/content/${content._id}/file`);
    expect(res.status).toBe(401);
  });

  it('Admin CAN now stream a file without needing an Enrollment record (regression fix)', async () => {
    const { course, unit1 } = await setupCourseWithTwoUnits();
    const content = await CourseContent.findOne({ unit_id: unit1._id });
    const admin = await createUserAndLogin({ role: 'Admin', email: 'admin2@example.com' });

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/content/${content._id}/file`)
      .set('Authorization', `Bearer ${admin.accessToken}`);

    // text content_type has no storage_path → FILE_NOT_FOUND is the
    // CORRECT outcome here (proves the role check passed and we reached
    // the file lookup — the old bug returned 403 NOT_ENROLLED before ever
    // getting this far).
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('FILE_NOT_FOUND');
  });

  it('a non-enrolled Student is rejected with 403 NOT_ENROLLED before any file lookup', async () => {
    const { course, unit1 } = await setupCourseWithTwoUnits();
    const content = await CourseContent.findOne({ unit_id: unit1._id });
    const student = await createUserAndLogin({ role: 'Student', email: 'student3@example.com' });

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/content/${content._id}/file`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_ENROLLED');
  });
});
