/**
 * Integration tests for Admin Course Review (UC-COURSE-07).
 * Covers GET /admin/courses/pending and POST /admin/courses/:courseId/review.
 *
 * NOTE: assertContentCompleteForPublish() calls assertPublishedExamExists()
 * FIRST and UNCONDITIONALLY — before the is_synchronous check and before the
 * units/content checks. This means EVERY course (sync or not) needs a
 * published 'exam' quiz before it can be published. Tests below create one
 * wherever the flow is expected to proceed past that gate.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const User = require('../../src/models/User');
const Course = require('../../src/models/Course');
const Enrollment = require('../../src/models/Enrollment');
const CourseUnit = require('../../src/models/CourseUnit');
const CourseContent = require('../../src/models/CourseContent');
const Session = require('../../src/models/Session');
const CourseReviewRequest = require('../../src/models/CourseReviewRequest');
const Quiz = require('../../src/models/quiz.model');
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
    Session.deleteMany({}),
    CourseReviewRequest.deleteMany({}),
    Quiz.deleteMany({}),
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
    role: overrides.role || 'Instructor',
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

/**
 * Creates a published 'exam' quiz for the given course — satisfies the
 * unconditional assertPublishedExamExists() gate in the service layer.
 * Adjust the field set here if the real Quiz schema requires more.
 */
async function createPublishedExam({ courseId, instructorId }) {
  return Quiz.create({
    course_id: courseId,
    unit_id: null,
    instructor_id: instructorId,
    quiz_type: 'exam',
    title: 'Final Exam',
    status: 'published',
    locked: false,
    start_time: new Date(Date.now() - 60 * 60 * 1000), // بدأ منذ ساعة
    end_time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // ينتهي بعد أسبوع
    duration_minutes: 60,
    passing_score_percent: 60,
    max_attempts: 1,
    questions: [
      {
        question_type: 'mcq',
        text: 'What is 2 + 2?',
        choices: [
          { text: '4', is_correct: true },
          { text: '5', is_correct: false },
          { text: '22', is_correct: false },
        ],
      },
    ],
  });
}

const baseCoursePayload = {
  title: 'Course Pending Review',
  description: 'Some description long enough.',
  category: 'Technology & Computer Science',
  course_type: 'free',
};

describe('GET /api/v1/admin/courses/pending', () => {
  it('returns only pending_review courses', async () => {
    const admin = await createUserAndLogin({
      role: 'Admin',
      kyc_status: 'not_submitted',
      mfa_enabled: true,
    });
    const instructor = await createUserAndLogin({ role: 'Instructor' });

    await Course.create({
      ...baseCoursePayload,
      is_synchronous: false,
      owner_instructor_id: instructor.user._id,
      status: 'draft',
    });
    const pendingCourse = await Course.create({
      ...baseCoursePayload,
      is_synchronous: false,
      owner_instructor_id: instructor.user._id,
      status: 'pending_review',
    });
    await Course.create({
      ...baseCoursePayload,
      is_synchronous: false,
      owner_instructor_id: instructor.user._id,
      status: 'published',
    });

    const res = await request(app)
      .get('/api/v1/admin/courses/pending')
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.courses).toHaveLength(1);
    expect(res.body.data.courses[0]._id).toBe(pendingCourse._id.toString());
  });

  it('returns an empty list when nothing is pending', async () => {
    const admin = await createUserAndLogin({
      role: 'Admin',
      kyc_status: 'not_submitted',
      mfa_enabled: true,
    });

    const res = await request(app)
      .get('/api/v1/admin/courses/pending')
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.courses).toHaveLength(0);
  });

  it('rejects Student/Instructor access with 403', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });

    const res = await request(app)
      .get('/api/v1/admin/courses/pending')
      .set('Authorization', `Bearer ${instructor.accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('POST /api/v1/admin/courses/:courseId/review — publish decision', () => {
  it('rejects publishing a course with NO published exam (EXAM_REQUIRED) — checked before anything else', async () => {
    const admin = await createUserAndLogin({
      role: 'Admin',
      kyc_status: 'not_submitted',
      mfa_enabled: true,
    });
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const course = await Course.create({
      ...baseCoursePayload,
      is_synchronous: false,
      owner_instructor_id: instructor.user._id,
      status: 'pending_review',
    });

    const res = await request(app)
      .post(`/api/v1/admin/courses/${course._id}/review`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ decision: 'publish' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EXAM_REQUIRED');

    const unchanged = await Course.findById(course._id);
    expect(unchanged.status).toBe('pending_review');
  });

  it('rejects publishing an async course with NO units at all, once the exam gate is satisfied (EXT-COURSE-02)', async () => {
    const admin = await createUserAndLogin({
      role: 'Admin',
      kyc_status: 'not_submitted',
      mfa_enabled: true,
    });
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const course = await Course.create({
      ...baseCoursePayload,
      is_synchronous: false,
      owner_instructor_id: instructor.user._id,
      status: 'pending_review',
    });
    await createPublishedExam({ courseId: course._id, instructorId: instructor.user._id });

    const res = await request(app)
      .post(`/api/v1/admin/courses/${course._id}/review`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ decision: 'publish' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_UNITS');

    const unchanged = await Course.findById(course._id);
    expect(unchanged.status).toBe('pending_review');
  });

  it('rejects publishing an async course with a unit that has NO content, once the exam gate is satisfied (EXT-COURSE-02)', async () => {
    const admin = await createUserAndLogin({
      role: 'Admin',
      kyc_status: 'not_submitted',
      mfa_enabled: true,
    });
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const course = await Course.create({
      ...baseCoursePayload,
      is_synchronous: false,
      owner_instructor_id: instructor.user._id,
      status: 'pending_review',
    });
    await createPublishedExam({ courseId: course._id, instructorId: instructor.user._id });

    const unitWithContent = await CourseUnit.create({
      course_id: course._id,
      title: 'Unit With Content',
      order: 1,
    });
    await CourseContent.create({
      course_id: course._id,
      unit_id: unitWithContent._id,
      owner_instructor_id: instructor.user._id,
      title: 'Unit Content Title',
      content_type: 'text',
      content_data: { text: 'Lesson' },
      order: 1,
    });
    const emptyUnit = await CourseUnit.create({
      course_id: course._id,
      title: 'Empty Unit',
      order: 2,
    });

    const res = await request(app)
      .post(`/api/v1/admin/courses/${course._id}/review`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ decision: 'publish' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNIT_HAS_NO_CONTENT');
    expect(res.body.error.message).toMatch(new RegExp(emptyUnit.title));
  });

  it('allows publishing a SYNCHRONOUS course with NO units, given a published exam (exam gate applies to sync courses too)', async () => {
    const admin = await createUserAndLogin({
      role: 'Admin',
      kyc_status: 'not_submitted',
      mfa_enabled: true,
    });
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const course = await Course.create({
      ...baseCoursePayload,
      is_synchronous: true,
      owner_instructor_id: instructor.user._id,
      status: 'pending_review',
    });
    await createPublishedExam({ courseId: course._id, instructorId: instructor.user._id });

    const res = await request(app)
      .post(`/api/v1/admin/courses/${course._id}/review`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ decision: 'publish' });

    expect(res.status).toBe(200);
    expect(res.body.data.course.status).toBe('published');
  });

  it('rejects publishing a SYNCHRONOUS course with NO units and NO published exam — exam gate is unconditional', async () => {
    const admin = await createUserAndLogin({
      role: 'Admin',
      kyc_status: 'not_submitted',
      mfa_enabled: true,
    });
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const course = await Course.create({
      ...baseCoursePayload,
      is_synchronous: true,
      owner_instructor_id: instructor.user._id,
      status: 'pending_review',
    });

    const res = await request(app)
      .post(`/api/v1/admin/courses/${course._id}/review`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ decision: 'publish' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EXAM_REQUIRED');
  });

  it('publishes a fully-complete async course successfully, sets published_at and content_complete', async () => {
    const admin = await createUserAndLogin({
      role: 'Admin',
      kyc_status: 'not_submitted',
      mfa_enabled: true,
    });
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const course = await Course.create({
      ...baseCoursePayload,
      is_synchronous: false,
      owner_instructor_id: instructor.user._id,
      status: 'pending_review',
      completion_threshold: 0.7,
    });
    await createPublishedExam({ courseId: course._id, instructorId: instructor.user._id });

    const unit = await CourseUnit.create({ course_id: course._id, title: 'Unit 1', order: 1 });
    await CourseContent.create({
      course_id: course._id,
      unit_id: unit._id,
      owner_instructor_id: instructor.user._id,
      title: 'Unit Content Title',
      content_type: 'text',
      content_data: { text: 'Lesson' },
      order: 1,
    });
    await CourseReviewRequest.create({
      course_id: course._id,
      requested_by: instructor.user._id,
      status: 'pending_review',
      changes_snapshot: { change_type: 'INITIAL_SUBMISSION' },
    });

    const res = await request(app)
      .post(`/api/v1/admin/courses/${course._id}/review`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ decision: 'publish' });

    expect(res.status).toBe(200);
    expect(res.body.data.course.status).toBe('published');
    expect(res.body.data.course.published_at).not.toBeNull();
    expect(res.body.data.course.content_complete).toBe(true);

    const reviewRequest = await CourseReviewRequest.findOne({ course_id: course._id });
    expect(reviewRequest.status).toBe('approved');
    expect(reviewRequest.reviewer_id.toString()).toBe(admin.user._id.toString());
    expect(reviewRequest.reviewed_at).not.toBeNull();
  });
});

describe('POST /api/v1/admin/courses/:courseId/review — reject decision', () => {
  it('rejects with 400 from Zod when reason is missing', async () => {
    const admin = await createUserAndLogin({
      role: 'Admin',
      kyc_status: 'not_submitted',
      mfa_enabled: true,
    });
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const course = await Course.create({
      ...baseCoursePayload,
      is_synchronous: false,
      owner_instructor_id: instructor.user._id,
      status: 'pending_review',
    });

    const res = await request(app)
      .post(`/api/v1/admin/courses/${course._id}/review`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ decision: 'reject' }); // no reason

    expect(res.status).toBe(400);

    const unchanged = await Course.findById(course._id);
    expect(unchanged.status).toBe('pending_review');
  });

  it('rejects the course with free-text reason, updates status and CourseReviewRequest', async () => {
    const admin = await createUserAndLogin({
      role: 'Admin',
      kyc_status: 'not_submitted',
      mfa_enabled: true,
    });
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const course = await Course.create({
      ...baseCoursePayload,
      is_synchronous: false,
      owner_instructor_id: instructor.user._id,
      status: 'pending_review',
    });
    await CourseReviewRequest.create({
      course_id: course._id,
      requested_by: instructor.user._id,
      status: 'pending_review',
      changes_snapshot: { change_type: 'INITIAL_SUBMISSION' },
    });

    const res = await request(app)
      .post(`/api/v1/admin/courses/${course._id}/review`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ decision: 'reject', reason: 'Content does not meet academic standards.' });

    expect(res.status).toBe(200);
    expect(res.body.data.course.status).toBe('rejected');
    expect(res.body.data.course.rejection_reason).toBe('Content does not meet academic standards.');

    const reviewRequest = await CourseReviewRequest.findOne({ course_id: course._id });
    expect(reviewRequest.status).toBe('rejected');
    expect(reviewRequest.rejection_reason).toBe('Content does not meet academic standards.');
  });
});

describe('POST /api/v1/admin/courses/:courseId/review — needs_revision decision', () => {
  it('reverts course to draft and marks CourseReviewRequest as needs_revision (distinct from cancelled)', async () => {
    const admin = await createUserAndLogin({
      role: 'Admin',
      kyc_status: 'not_submitted',
      mfa_enabled: true,
    });
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const course = await Course.create({
      ...baseCoursePayload,
      is_synchronous: false,
      owner_instructor_id: instructor.user._id,
      status: 'pending_review',
    });
    await CourseReviewRequest.create({
      course_id: course._id,
      requested_by: instructor.user._id,
      status: 'pending_review',
      changes_snapshot: { change_type: 'INITIAL_SUBMISSION' },
    });

    const res = await request(app)
      .post(`/api/v1/admin/courses/${course._id}/review`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ decision: 'needs_revision', reason: 'Please add more units.' });

    expect(res.status).toBe(200);
    expect(res.body.data.course.status).toBe('draft');

    const reviewRequest = await CourseReviewRequest.findOne({ course_id: course._id });
    expect(reviewRequest.status).toBe('needs_revision');
  });
});

describe('POST /api/v1/admin/courses/:courseId/review — state guards', () => {
  it('rejects with 409 NOT_PENDING_REVIEW when course is not pending_review', async () => {
    const admin = await createUserAndLogin({
      role: 'Admin',
      kyc_status: 'not_submitted',
      mfa_enabled: true,
    });
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const course = await Course.create({
      ...baseCoursePayload,
      is_synchronous: false,
      owner_instructor_id: instructor.user._id,
      status: 'draft',
    });

    const res = await request(app)
      .post(`/api/v1/admin/courses/${course._id}/review`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ decision: 'publish' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_PENDING_REVIEW');
  });

  it('rejects with 404 COURSE_NOT_FOUND for a non-existent course id', async () => {
    const admin = await createUserAndLogin({
      role: 'Admin',
      kyc_status: 'not_submitted',
      mfa_enabled: true,
    });
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .post(`/api/v1/admin/courses/${fakeId}/review`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ decision: 'publish' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COURSE_NOT_FOUND');
  });
});

describe('POST /api/v1/admin/courses/:courseId/review — requireRole enforcement', () => {
  it('rejects Instructor access with 403, course status unchanged', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const course = await Course.create({
      ...baseCoursePayload,
      is_synchronous: false,
      owner_instructor_id: instructor.user._id,
      status: 'pending_review',
    });

    const res = await request(app)
      .post(`/api/v1/admin/courses/${course._id}/review`)
      .set('Authorization', `Bearer ${instructor.accessToken}`)
      .send({ decision: 'publish' });

    expect(res.status).toBe(403);

    const unchanged = await Course.findById(course._id);
    expect(unchanged.status).toBe('pending_review');
  });
});

describe('PATCH /api/v1/admin/courses/:courseId/status', () => {
  it('suspends a published course, sets suspended_by', async () => {
    const admin = await createUserAndLogin({
      role: 'Admin',
      kyc_status: 'not_submitted',
      mfa_enabled: true,
    });
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const course = await Course.create({
      ...baseCoursePayload,
      is_synchronous: false,
      owner_instructor_id: instructor.user._id,
      status: 'published',
    });

    const res = await request(app)
      .patch(`/api/v1/admin/courses/${course._id}/status`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ status: 'suspended' });

    expect(res.status).toBe(200);
    expect(res.body.data.course.status).toBe('suspended');
    expect(res.body.data.course.suspended_by).toBe(admin.user._id.toString());
  });

  it('archives a course', async () => {
    const admin = await createUserAndLogin({
      role: 'Admin',
      kyc_status: 'not_submitted',
      mfa_enabled: true,
    });
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const course = await Course.create({
      ...baseCoursePayload,
      is_synchronous: false,
      owner_instructor_id: instructor.user._id,
      status: 'draft',
    });

    const res = await request(app)
      .patch(`/api/v1/admin/courses/${course._id}/status`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ status: 'archived' });

    expect(res.status).toBe(200);
    expect(res.body.data.course.status).toBe('archived');
  });

  it('rejects further changes to an already-archived course with 409', async () => {
    const admin = await createUserAndLogin({
      role: 'Admin',
      kyc_status: 'not_submitted',
      mfa_enabled: true,
    });
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const course = await Course.create({
      ...baseCoursePayload,
      is_synchronous: false,
      owner_instructor_id: instructor.user._id,
      status: 'archived',
    });

    const res = await request(app)
      .patch(`/api/v1/admin/courses/${course._id}/status`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ status: 'suspended' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COURSE_ARCHIVED');
  });

  it('rejects reactivation to published when the course is not currently suspended → 409 INVALID_TRANSITION', async () => {
    const admin = await createUserAndLogin({
      role: 'Admin',
      kyc_status: 'not_submitted',
      mfa_enabled: true,
    });
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const course = await Course.create({
      ...baseCoursePayload,
      is_synchronous: false,
      owner_instructor_id: instructor.user._id,
      status: 'draft',
    });

    const res = await request(app)
      .patch(`/api/v1/admin/courses/${course._id}/status`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ status: 'published' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('rejects a genuinely invalid status value at the Zod layer → 400 VALIDATION_ERROR', async () => {
    const admin = await createUserAndLogin({
      role: 'Admin',
      kyc_status: 'not_submitted',
      mfa_enabled: true,
    });
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const course = await Course.create({
      ...baseCoursePayload,
      is_synchronous: false,
      owner_instructor_id: instructor.user._id,
      status: 'published',
    });

    const res = await request(app)
      .patch(`/api/v1/admin/courses/${course._id}/status`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ status: 'not_a_real_status' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when an ALREADY-enrolled student attempts to access a suspended course', async () => {
    const admin = await createUserAndLogin({
      role: 'Admin',
      kyc_status: 'not_submitted',
      mfa_enabled: true,
    });
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin({ role: 'Student' });
    const course = await Course.create({
      ...baseCoursePayload,
      is_synchronous: false,
      owner_instructor_id: instructor.user._id,
      status: 'published',
    });
    await Enrollment.create({
      course_id: course._id,
      student_id: student.user._id,
      status: 'active',
      confirmed_by_student: true,
    });

    await request(app)
      .patch(`/api/v1/admin/courses/${course._id}/status`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ status: 'suspended' });

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(404); // Aligns exactly with `course.service.js` which requires 'published'
  });

  it('rejects Instructor access with 403', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const course = await Course.create({
      ...baseCoursePayload,
      is_synchronous: false,
      owner_instructor_id: instructor.user._id,
      status: 'published',
    });

    const res = await request(app)
      .patch(`/api/v1/admin/courses/${course._id}/status`)
      .set('Authorization', `Bearer ${instructor.accessToken}`)
      .send({ status: 'suspended' });

    expect(res.status).toBe(403);
  });
});
