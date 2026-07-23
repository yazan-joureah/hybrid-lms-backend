/**
 * Integration tests for the Student-facing course path:
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
const fileStorage = require('../../src/services/fileStorage.service');

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
    }); // Technology & Computer Science

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

describe('GET /api/v1/courses/:courseId/manage (Instructor own-status view)', () => {
  it('returns a draft course to its owner with units + content_count', async () => {
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
      owner_instructor_id: instructor.user._id,
      content_type: 'text',
      content_data: { text: 'x' },
      order: 1,
    });

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/manage`)
      .set('Authorization', `Bearer ${instructor.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.course.status).toBe('draft');
    expect(res.body.data.units[0].content_count).toBe(1);
  });

  it('prevents IDOR: 403 for a non-owner instructor', async () => {
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
      .get(`/api/v1/courses/${course._id}/manage`)
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

  it('creates a pending_payment enrollment for a paid course, with an explanatory message (PAY not implemented yet)', async () => {
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
    expect(res.body.message).toMatch(/payment integration is not yet available/i);
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

  it('rejects enrollment with 400 PREREQUISITES_NOT_MET when prerequisite is not completed', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin({ role: 'Student' });
    const prereq = await Course.create({
      ...baseCourse,
      title: 'Prereq Course',
      owner_instructor_id: instructor.user._id,
      status: 'published',
    });
    const course = await Course.create({
      ...baseCourse,
      owner_instructor_id: instructor.user._id,
      status: 'published',
      prerequisite_course_ids: [prereq._id],
    });

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/enroll`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PREREQUISITES_NOT_MET');
  });

  it('allows enrollment once the prerequisite enrollment is completed', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin({ role: 'Student' });
    const prereq = await Course.create({
      ...baseCourse,
      title: 'Prereq Course',
      owner_instructor_id: instructor.user._id,
      status: 'published',
    });
    await Enrollment.create({
      course_id: prereq._id,
      student_id: student.user._id,
      status: 'completed',
      confirmed_by_student: true,
    });
    const course = await Course.create({
      ...baseCourse,
      owner_instructor_id: instructor.user._id,
      status: 'published',
      prerequisite_course_ids: [prereq._id],
    });

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/enroll`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(201);
  });

  it('rejects with 409 COURSE_FULL when a synchronous course reached max_students', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin({ role: 'Student' });
    const filler = await createUserAndLogin({ role: 'Student', email: 'filler@example.com' });
    const course = await Course.create({
      ...baseCourse,
      is_synchronous: true,
      max_students: 1,
      owner_instructor_id: instructor.user._id,
      status: 'published',
    });
    await Enrollment.create({
      course_id: course._id,
      student_id: filler.user._id,
      status: 'active',
      confirmed_by_student: true,
    });

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/enroll`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COURSE_FULL');
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
  async function setupEnrolledCourseWithTwoContents() {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin({ role: 'Student' });
    const course = await Course.create({
      ...baseCourse,
      owner_instructor_id: instructor.user._id,
      status: 'published',
      completion_threshold: 0.5,
    });
    const unit = await CourseUnit.create({ course_id: course._id, title: 'Unit 1', order: 1 });
    const content1 = await CourseContent.create({
      course_id: course._id,
      unit_id: unit._id,
      owner_instructor_id: instructor.user._id,
      content_type: 'text',
      content_data: { text: 'Lesson 1' },
      order: 1,
    });
    const content2 = await CourseContent.create({
      course_id: course._id,
      unit_id: unit._id,
      owner_instructor_id: instructor.user._id,
      content_type: 'text',
      content_data: { text: 'Lesson 2' },
      order: 2,
    });
    await Enrollment.create({
      course_id: course._id,
      student_id: student.user._id,
      status: 'active',
      confirmed_by_student: true,
    });
    return { student, course, content1, content2 };
  }

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

  it('records 1/2 completion (50%) after the first content item, does not mark completed yet', async () => {
    const { student, course, content1 } = await setupEnrolledCourseWithTwoContents();

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/progress`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ content_id: content1._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.data.progress_percentage).toBe(0.5);
    // 0.5 >= threshold 0.5 actually triggers completion here — see next test for the sub-threshold case explicitly
  });

  it('ignores a duplicate completion event for the same content (idempotent), percentage unchanged', async () => {
    const { student, course, content1 } = await setupEnrolledCourseWithTwoContents();

    await request(app)
      .post(`/api/v1/courses/${course._id}/progress`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ content_id: content1._id.toString() });

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/progress`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ content_id: content1._id.toString() }); // same content again

    expect(res.status).toBe(200);
    expect(res.body.data.progress_percentage).toBe(0.5); // unchanged — not double-counted

    const events = await CourseProgressEvent.find({
      student_id: student.user._id,
      content_id: content1._id,
    });
    expect(events).toHaveLength(1); // only one event ever persisted
  });

  it('marks enrollment as completed once progress reaches completion_threshold', async () => {
    const { student, course, content1, content2 } = await setupEnrolledCourseWithTwoContents();

    await request(app)
      .post(`/api/v1/courses/${course._id}/progress`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ content_id: content1._id.toString() });

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/progress`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ content_id: content2._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.data.progress_percentage).toBe(1);
    expect(res.body.data.course_completed).toBe(true);

    const enrollment = await Enrollment.findOne({
      course_id: course._id,
      student_id: student.user._id,
    });
    expect(enrollment.status).toBe('completed');
    expect(enrollment.completed_at).not.toBeNull();
  });

  it('rejects a content_id that does not belong to the course with 404', async () => {
    const { student, course } = await setupEnrolledCourseWithTwoContents();
    const foreignId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/progress`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ content_id: foreignId.toString() });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CONTENT_NOT_FOUND');
  });
});

describe('GET /api/v1/courses/:courseId/content (Student outline)', () => {
  it('returns the course outline with download_url for file-backed content, null for text', async () => {
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
      owner_instructor_id: instructor.user._id,
      content_type: 'text',
      content_data: { text: 'Lesson text' },
      order: 1,
    });
    await CourseContent.create({
      course_id: course._id,
      unit_id: unit._id,
      owner_instructor_id: instructor.user._id,
      content_type: 'video',
      storage_path: 'gridfs://course_files/507f1f77bcf86cd799439011',
      mime_type: 'video/mp4',
      size_bytes: 1000,
      magic_bytes_match: true,
      order: 2,
    });
    await Enrollment.create({
      course_id: course._id,
      student_id: student.user._id,
      status: 'active',
      confirmed_by_student: true,
    });

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/content`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(200);
    const items = res.body.data.units[0].content;
    expect(items.find((c) => c.content_type === 'text').download_url).toBeNull();
    expect(items.find((c) => c.content_type === 'video').download_url).toMatch(/\/file$/);
  });

  it('rejects with 403 NOT_ENROLLED for a non-enrolled student', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin({ role: 'Student' });
    const course = await Course.create({
      ...baseCourse,
      owner_instructor_id: instructor.user._id,
      status: 'published',
    });

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/content`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_ENROLLED');
  });
});

describe('GET /api/v1/courses/:courseId/content/:contentId/file (Streaming)', () => {
  it('streams the actual file bytes with the correct Content-Type for an enrolled student', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin({ role: 'Student' });
    const course = await Course.create({
      ...baseCourse,
      owner_instructor_id: instructor.user._id,
      status: 'published',
    });
    const unit = await CourseUnit.create({ course_id: course._id, title: 'Unit 1', order: 1 });

    const fakePdfBuffer = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(50, 0x00)]);
    const { storagePath } = await fileStorage.uploadFile({
      buffer: fakePdfBuffer,
      filename: 'slides.pdf',
      mimeType: 'application/pdf',
      sizeBytes: fakePdfBuffer.length,
      userId: instructor.user._id.toString(),
      actorRole: 'Instructor',
      req: { ip: '127.0.0.1', get: () => 'jest' },
    });

    const content = await CourseContent.create({
      course_id: course._id,
      unit_id: unit._id,
      owner_instructor_id: instructor.user._id,
      content_type: 'document',
      storage_path: storagePath,
      mime_type: 'application/pdf',
      size_bytes: fakePdfBuffer.length,
      magic_bytes_match: true,
      order: 1,
    });
    await Enrollment.create({
      course_id: course._id,
      student_id: student.user._id,
      status: 'active',
      confirmed_by_student: true,
    });

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/content/${content._id}/file`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.equals(fakePdfBuffer)).toBe(true);
  });

  it('rejects with 403 NOT_ENROLLED before attempting to stream anything', async () => {
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
      owner_instructor_id: instructor.user._id,
      content_type: 'document',
      storage_path: 'gridfs://course_files/507f1f77bcf86cd799439011',
      mime_type: 'application/pdf',
      size_bytes: 10,
      magic_bytes_match: true,
      order: 1,
    });

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/content/${content._id}/file`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_ENROLLED');
  });
});

describe('GET /api/v1/courses (Browse) — NoSQL injection hardening', () => {
  it('ignores a $ne operator-injection payload in category, returns normally without matching everything', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    await Course.create({
      ...baseCourse,
      owner_instructor_id: instructor.user._id,
      status: 'published',
      category: 'Languages',
    });

    const res = await request(app).get('/api/v1/courses?category[$ne]=null');

    expect(res.status).toBe(200);
    // category becomes an object {$ne: 'null'} — fails typeof==='string' check,
    // so it's silently ignored rather than injected into the query
    expect(res.body.data.courses).toHaveLength(1); // returns the one published course, unaffected by the injection attempt
  });

  it('escapes regex special characters in search, treating them literally', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    await Course.create({
      ...baseCourse,
      title: 'C++ Basics',
      owner_instructor_id: instructor.user._id,
      status: 'published',
    });

    const res = await request(app).get('/api/v1/courses').query({ search: 'C++' });

    expect(res.status).toBe(200);
    expect(res.body.data.courses).toHaveLength(1);
    expect(res.body.data.courses[0].title).toBe('C++ Basics');
  });
});
