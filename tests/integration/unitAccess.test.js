/**
 * Integration tests for Unit Access (Student and Admin).
 * Tests GET /courses/:courseId/units/:unitId/student-view (Student)
 * Tests GET /admin/courses/:courseId/units/:unitId (Admin)
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const User = require('../../src/models/User');
const Course = require('../../src/models/Course');
const Session = require('../../src/models/Session');
const CourseUnit = require('../../src/models/CourseUnit');
const CourseContent = require('../../src/models/CourseContent');
const Enrollment = require('../../src/models/Enrollment');
const CourseProgressEvent = require('../../src/models/CourseProgressEvent');
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
    Session.deleteMany({}),
    CourseUnit.deleteMany({}),
    CourseContent.deleteMany({}),
    Enrollment.deleteMany({}),
    CourseProgressEvent.deleteMany({}),
  ]);
  if (redisClient.isOpen) await redisClient.flushdb();
});

afterAll(async () => {
  await mongoose.connection.close();
  await redisClient.quit();
});

// Helper to create users with specific states and a valid session
async function createUserAndLogin(role = 'Student', overrides = {}) {
  const passwordHash = await hashPassword(PLAIN_PASSWORD);
  const user = await User.create({
    full_name: overrides.full_name || `Test ${role}`,
    email: overrides.email || `${role.toLowerCase()}${Date.now()}@example.com`,
    password_hash: passwordHash,
    birth_date: new Date('1990-01-01'),
    role,
    status: 'active',
    email_verified_at: new Date(),
    kyc_status:
      overrides.kyc_status !== undefined
        ? overrides.kyc_status
        : role === 'Instructor'
          ? 'verified'
          : 'not_submitted',
    mfa_enabled:
      overrides.mfa_enabled !== undefined ? overrides.mfa_enabled : role === 'Instructor',
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

  const accessToken = signAccessToken({
    userId: user._id,
    sessionId: session._id,
  });

  return { accessToken, user };
}

// Helper to create a complete course with units and content
async function createPublishedCourseWithContent() {
  const { user: instructor } = await createUserAndLogin('Instructor');

  const course = await Course.create({
    title: 'Full Stack Development',
    description: 'Learn full stack development',
    category: 'Technology & Computer Science',
    course_type: 'free',
    is_synchronous: false,
    owner_instructor_id: instructor._id,
    status: 'published',
    published_at: new Date(),
    completion_threshold: 0.7,
    content_complete: true,
  });

  const unit1 = await CourseUnit.create({
    course_id: course._id,
    title: 'Introduction to React',
    desc: 'Learn React basics',
    order: 1,
  });

  const unit2 = await CourseUnit.create({
    course_id: course._id,
    title: 'Advanced React',
    desc: 'Learn advanced React patterns',
    order: 2,
  });

  const unit3 = await CourseUnit.create({
    course_id: course._id,
    title: 'React Testing',
    desc: 'Learn how to test React apps',
    order: 3,
  });

  // Add content to unit2 (the middle unit for navigation testing)
  const content1 = await CourseContent.create({
    course_id: course._id,
    unit_id: unit2._id,
    owner_instructor_id: instructor._id,
    content_type: 'text',
    content_data: { text: 'Lesson 1: Hooks' },
    order: 1,
  });

  const content2 = await CourseContent.create({
    course_id: course._id,
    unit_id: unit2._id,
    owner_instructor_id: instructor._id,
    content_type: 'video',
    storage_path: 'gridfs://course_files/fakevideo123',
    mime_type: 'video/mp4',
    size_bytes: 1024000,
    order: 2,
  });

  const content3 = await CourseContent.create({
    course_id: course._id,
    unit_id: unit2._id,
    owner_instructor_id: instructor._id,
    content_type: 'link',
    content_data: { url: 'https://reactjs.org/docs' },
    order: 3,
  });

  return { course, unit1, unit2, unit3, content1, content2, content3, instructor };
}

describe('GET /api/v1/courses/:courseId/units/:unitId/student-view (Student Unit Access)', () => {
  it('fetches unit with progress tracking for enrolled student', async () => {
    const { course, unit2, content1 } = await createPublishedCourseWithContent();
    const { accessToken: studentToken, user: student } = await createUserAndLogin('Student');

    // Enroll student
    await Enrollment.create({
      course_id: course._id,
      student_id: student._id,
      status: 'active',
      confirmed_by_student: true,
      activated_at: new Date(),
    });

    // Mark first content as completed
    await CourseProgressEvent.create({
      course_id: course._id,
      student_id: student._id,
      unit_id: unit2._id,
      content_id: content1._id,
      event_type: 'lesson_completed',
      idempotency_key: `${student._id}:${content1._id}`,
      source: 'server',
    });

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/units/${unit2._id}/student-view`)
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.unit).toBeDefined();
    expect(res.body.data.unit.title).toBe('Advanced React');
    expect(res.body.data.unit.content).toHaveLength(3);
    expect(res.body.data.unit.content_count).toBe(3);
    expect(res.body.data.unit.completed_count).toBe(1);
    expect(res.body.data.unit.unit_progress).toBeCloseTo(0.333, 2);
  });

  it('marks completed content items correctly', async () => {
    const { course, unit2, content1 } = await createPublishedCourseWithContent();
    const { accessToken: studentToken, user: student } = await createUserAndLogin('Student');

    await Enrollment.create({
      course_id: course._id,
      student_id: student._id,
      status: 'active',
      confirmed_by_student: true,
      activated_at: new Date(),
    });

    await CourseProgressEvent.create({
      course_id: course._id,
      student_id: student._id,
      unit_id: unit2._id,
      content_id: content1._id,
      event_type: 'lesson_completed',
      idempotency_key: `${student._id}:${content1._id}`,
      source: 'server',
    });

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/units/${unit2._id}/student-view`)
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    const content = res.body.data.unit.content;
    expect(content[0].completed).toBe(true); // First content marked completed
    expect(content[1].completed).toBe(false); // Second not completed
    expect(content[2].completed).toBe(false); // Third not completed
  });

  it('includes navigation links (next and previous units)', async () => {
    const { course, unit2 } = await createPublishedCourseWithContent();
    const { accessToken: studentToken, user: student } = await createUserAndLogin('Student');

    await Enrollment.create({
      course_id: course._id,
      student_id: student._id,
      status: 'active',
      confirmed_by_student: true,
      activated_at: new Date(),
    });

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/units/${unit2._id}/student-view`)
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.unit.next_unit).toBeDefined();
    expect(res.body.data.unit.next_unit.title).toBe('React Testing');
    expect(res.body.data.unit.previous_unit).toBeDefined();
    expect(res.body.data.unit.previous_unit.title).toBe('Introduction to React');
  });

  it('includes download URLs for file-backed content', async () => {
    const { course, unit2 } = await createPublishedCourseWithContent();
    const { accessToken: studentToken, user: student } = await createUserAndLogin('Student');

    await Enrollment.create({
      course_id: course._id,
      student_id: student._id,
      status: 'active',
      confirmed_by_student: true,
      activated_at: new Date(),
    });

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/units/${unit2._id}/student-view`)
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    const videoContent = res.body.data.unit.content.find((c) => c.content_type === 'video');
    expect(videoContent.download_url).toBeDefined();
    expect(videoContent.download_url).toContain('/content/');
    expect(videoContent.download_url).toContain('/file');
  });

  it('includes course context information', async () => {
    const { course, unit2 } = await createPublishedCourseWithContent();
    const { accessToken: studentToken, user: student } = await createUserAndLogin('Student');

    await Enrollment.create({
      course_id: course._id,
      student_id: student._id,
      status: 'active',
      confirmed_by_student: true,
      activated_at: new Date(),
    });

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/units/${unit2._id}/student-view`)
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.course).toBeDefined();
    expect(res.body.data.course.title).toBe('Full Stack Development');
    expect(res.body.data.course.total_units).toBe(3);
  });

  it('rejects with 403 if student is not enrolled', async () => {
    const { course, unit2 } = await createPublishedCourseWithContent();
    const { accessToken: studentToken } = await createUserAndLogin('Student');

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/units/${unit2._id}/student-view`)
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_ENROLLED');
  });

  it('rejects with 404 if course does not exist', async () => {
    const { accessToken: studentToken } = await createUserAndLogin('Student');
    const fakeCourseId = new mongoose.Types.ObjectId();
    const fakeUnitId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .get(`/api/v1/courses/${fakeCourseId}/units/${fakeUnitId}/student-view`)
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COURSE_NOT_FOUND');
  });

  it('rejects with 404 if unit does not exist', async () => {
    const { course } = await createPublishedCourseWithContent();
    const { accessToken: studentToken, user: student } = await createUserAndLogin('Student');

    await Enrollment.create({
      course_id: course._id,
      student_id: student._id,
      status: 'active',
      confirmed_by_student: true,
      activated_at: new Date(),
    });

    const fakeUnitId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/units/${fakeUnitId}/student-view`)
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('UNIT_NOT_FOUND');
  });

  it('requires authentication', async () => {
    const { course, unit2 } = await createPublishedCourseWithContent();

    const res = await request(app).get(
      `/api/v1/courses/${course._id}/units/${unit2._id}/student-view`
    );

    expect(res.status).toBe(401);
  });

  it('requires student role', async () => {
    const { course, unit2 } = await createPublishedCourseWithContent();
    const { accessToken: instructorToken } = await createUserAndLogin('Instructor');

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/units/${unit2._id}/student-view`)
      .set('Authorization', `Bearer ${instructorToken}`);

    expect(res.status).toBe(403);
  });
});

describe('GET /api/v1/admin/courses/:courseId/units/:unitId (Admin Unit Access)', () => {
  it('fetches unit details for any course (any status)', async () => {
    const { course, unit2 } = await createPublishedCourseWithContent();
    const { accessToken: adminToken } = await createUserAndLogin('Admin');

    const res = await request(app)
      .get(`/api/v1/admin/courses/${course._id}/units/${unit2._id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.unit).toBeDefined();
    expect(res.body.data.unit.title).toBe('Advanced React');
    expect(res.body.data.unit.content).toHaveLength(3);
  });

  it('can access draft courses (unlike students)', async () => {
    const { user: instructor } = await createUserAndLogin('Instructor');

    const draftCourse = await Course.create({
      title: 'Draft Course',
      description: 'Work in progress',
      category: 'Technology & Computer Science',
      course_type: 'free',
      is_synchronous: false,
      owner_instructor_id: instructor._id,
      status: 'draft',
      content_complete: false,
    });

    const unit = await CourseUnit.create({
      course_id: draftCourse._id,
      title: 'Draft Unit',
      desc: 'Draft content',
      order: 1,
    });

    const { accessToken: adminToken } = await createUserAndLogin('Admin');

    const res = await request(app)
      .get(`/api/v1/admin/courses/${draftCourse._id}/units/${unit._id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.course.status).toBe('draft');
  });

  it('includes course status in response', async () => {
    const { course, unit2 } = await createPublishedCourseWithContent();
    const { accessToken: adminToken } = await createUserAndLogin('Admin');

    const res = await request(app)
      .get(`/api/v1/admin/courses/${course._id}/units/${unit2._id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.course).toBeDefined();
    expect(res.body.data.course.status).toBe('published');
  });

  it('rejects with 404 if course does not exist', async () => {
    const { accessToken: adminToken } = await createUserAndLogin('Admin');
    const fakeCourseId = new mongoose.Types.ObjectId();
    const fakeUnitId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .get(`/api/v1/admin/courses/${fakeCourseId}/units/${fakeUnitId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COURSE_NOT_FOUND');
  });

  it('rejects with 404 if unit does not exist', async () => {
    const { course } = await createPublishedCourseWithContent();
    const { accessToken: adminToken } = await createUserAndLogin('Admin');
    const fakeUnitId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .get(`/api/v1/admin/courses/${course._id}/units/${fakeUnitId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('UNIT_NOT_FOUND');
  });

  it('requires authentication', async () => {
    const { course, unit2 } = await createPublishedCourseWithContent();

    const res = await request(app).get(`/api/v1/admin/courses/${course._id}/units/${unit2._id}`);

    expect(res.status).toBe(401);
  });

  it('requires admin role', async () => {
    const { course, unit2 } = await createPublishedCourseWithContent();
    const { accessToken: studentToken } = await createUserAndLogin('Student');

    const res = await request(app)
      .get(`/api/v1/admin/courses/${course._id}/units/${unit2._id}`)
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(403);
  });

  it('works for SuperAdmin role', async () => {
    const { course, unit2 } = await createPublishedCourseWithContent();
    const { accessToken: superAdminToken } = await createUserAndLogin('SuperAdmin');

    const res = await request(app)
      .get(`/api/v1/admin/courses/${course._id}/units/${unit2._id}`)
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.unit.title).toBe('Advanced React');
  });
});
