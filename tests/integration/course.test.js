/**
 * Integration tests for Course Management (Instructor facing).
 * Covers POST /courses, GET /courses/instructor/my-courses,
 * PUT /courses/:courseId, and POST /courses/:courseId/submit-review.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const User = require('../../src/models/User');
const Course = require('../../src/models/Course');
const Session = require('../../src/models/Session');
const CourseReviewRequest = require('../../src/models/CourseReviewRequest');
const AuditLog = require('../../src/models/AuditLog');
const { hashPassword } = require('../../src/utils/crypto');
const redisClient = require('../../src/config/redis');
const { signAccessToken } = require('../../src/utils/jwt');
const CourseUnit = require('../../src/models/CourseUnit');
const CourseContent = require('../../src/models/CourseContent');
const Quiz = require('../../src/models/quiz.model');

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
    CourseReviewRequest.deleteMany({}),
    AuditLog.deleteMany({}),
    CourseUnit.deleteMany({}),
    Quiz.deleteMany({}),
    CourseContent.deleteMany({}),
    // SECURITY note: GridFS stores files in SEPARATE collections
    // (course_files.files / course_files.chunks), NOT covered by any
    // Mongoose model's deleteMany() above — must be cleaned explicitly,
    // otherwise orphaned binary chunks accumulate silently across test runs.
    mongoose.connection.collection('course_files.files').deleteMany({}),
    mongoose.connection.collection('course_files.chunks').deleteMany({}),
  ]);
  if (redisClient.isOpen) await redisClient.flushdb();
});

afterAll(async () => {
  await mongoose.connection.close();
  await redisClient.quit();
});

// Helper to create users with specific states and a valid session
async function createInstructorAndLogin(overrides = {}) {
  const passwordHash = await hashPassword(PLAIN_PASSWORD);
  const user = await User.create({
    full_name: overrides.full_name || 'Valid Instructor',
    email: overrides.email || 'instructor1@example.com',
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

  // Create a real session (required by auth middleware)
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

// Must match the validation schema
const validCoursePayload = {
  title: 'Introduction to Advanced Testing',
  description: 'A comprehensive guide to integration tests.',
  category: 'Technology & Computer Science',
  course_type: 'free',
  is_synchronous: false,
};

// Real magic-byte signatures — same rigor as fileValidation KYC tests (real
// bytes, never mocking the file-type library).
function fakePdf() {
  return Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x00)]);
}
function fakeMp4() {
  // Minimal valid ISO-BMFF 'ftyp' box — recognized by file-type as video/mp4
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftyp'),
    Buffer.from('mp42'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from('mp42isom'),
    Buffer.alloc(200, 0x00),
  ]);
}

describe('POST /api/v1/courses (Create Course)', () => {
  it('creates a draft course successfully when KYC and MFA are met', async () => {
    const { accessToken, user } = await createInstructorAndLogin();

    const res = await request(app)
      .post('/api/v1/courses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validCoursePayload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.course.status).toBe('draft');
    expect(res.body.data.course.owner_instructor_id.toString()).toBe(user._id.toString());
  });

  it('rejects creation with 403 if KYC is not verified', async () => {
    const { accessToken } = await createInstructorAndLogin({
      email: 'nokyc@example.com',
      kyc_status: 'not_submitted',
    });

    const res = await request(app)
      .post('/api/v1/courses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validCoursePayload);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('KYC_NOT_VERIFIED');
  });

  it('rejects creation with 403 if MFA is disabled', async () => {
    const { accessToken } = await createInstructorAndLogin({
      email: 'nomfa@example.com',
      mfa_enabled: false,
    });

    const res = await request(app)
      .post('/api/v1/courses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validCoursePayload);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MFA_REQUIRED');
  });
});

describe('PUT /api/v1/courses/:courseId (Update Course)', () => {
  it('updates a course successfully if the user is the owner', async () => {
    const { accessToken, user } = await createInstructorAndLogin();

    // Create initial course – note the model uses "category"
    const course = await Course.create({
      title: validCoursePayload.title,
      description: validCoursePayload.description,
      category: validCoursePayload.category, // model field is category
      course_type: validCoursePayload.course_type,
      is_synchronous: validCoursePayload.is_synchronous,
      owner_instructor_id: user._id,
      status: 'draft',
      content_complete: false,
    });

    const res = await request(app)
      .put(`/api/v1/courses/${course._id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Updated Title' });

    expect(res.status).toBe(200);
    expect(res.body.data.course.title).toBe('Updated Title');
  });

  it('prevents IDOR: rejects update with 403 if user is not the owner', async () => {
    const instructorA = await createInstructorAndLogin({ email: 'a@example.com' });
    const course = await Course.create({
      title: validCoursePayload.title,
      description: validCoursePayload.description,
      category: validCoursePayload.category,
      course_type: validCoursePayload.course_type,
      is_synchronous: validCoursePayload.is_synchronous,
      owner_instructor_id: instructorA.user._id,
      status: 'draft',
      content_complete: false,
    });

    const instructorB = await createInstructorAndLogin({ email: 'b@example.com' });

    const res = await request(app)
      .put(`/api/v1/courses/${course._id}`)
      .set('Authorization', `Bearer ${instructorB.accessToken}`)
      .send({ title: 'Hacked Title' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('POST /api/v1/courses/:courseId/submit-review (Submit for Review)', () => {
  it('submits a draft course for review successfully when content AND a published exam exist', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const course = await Course.create({
      ...validCoursePayload,
      owner_instructor_id: user._id,
      status: 'draft',
      content_complete: false,
    });
    const unit = await CourseUnit.create({ course_id: course._id, title: 'Unit 1', order: 1 });
    await CourseContent.create({
      course_id: course._id,
      unit_id: unit._id,
      owner_instructor_id: user._id,
      title: 'Intro to course',
      content_type: 'text',
      content_data: { text: 'Intro text' },
      order: 1,
    });
    // submitCourseForReview() calls assertPublishedExamExists() unconditionally
    await Quiz.create({
      course_id: course._id,
      unit_id: null,
      instructor_id: user._id,
      quiz_type: 'exam',
      title: 'Final Exam',
      status: 'published',
      locked: false,
      start_time: new Date(Date.now() - 60 * 60 * 1000),
      end_time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
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

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/submit-review`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    const updatedCourse = await Course.findById(course._id);
    expect(updatedCourse.status).toBe('pending_review');
    expect(updatedCourse.content_complete).toBe(true);
  });

  it('rejects submission with 400 COURSE_CONTENT_INCOMPLETE when the course has no content (checked before the exam gate)', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const course = await Course.create({
      ...validCoursePayload,
      owner_instructor_id: user._id,
      status: 'draft',
    });

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/submit-review`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('COURSE_CONTENT_INCOMPLETE');
  });

  it('rejects submission with 400 EXAM_REQUIRED when content exists but no published exam does', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const course = await Course.create({
      ...validCoursePayload,
      owner_instructor_id: user._id,
      status: 'draft',
    });
    const unit = await CourseUnit.create({ course_id: course._id, title: 'Unit 1', order: 1 });
    await CourseContent.create({
      course_id: course._id,
      unit_id: unit._id,
      owner_instructor_id: user._id,
      title: 'Intro to course',
      content_type: 'text',
      content_data: { text: 'Intro text' },
      order: 1,
    });

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/submit-review`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EXAM_REQUIRED');

    const unchanged = await Course.findById(course._id);
    expect(unchanged.status).toBe('draft');
  });
});

describe('POST /api/v1/courses/:courseId/units (Add Unit)', () => {
  it('adds a unit with server-computed order=1, ignoring client-sent order', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const course = await Course.create({
      ...validCoursePayload,
      owner_instructor_id: user._id,
      status: 'draft',
    });

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/units`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Unit One', order: 999 });

    expect(res.status).toBe(201);
    expect(res.body.data.unit.order).toBe(1);
  });

  it('computes order=2 for a second unit on the same course', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const course = await Course.create({
      ...validCoursePayload,
      owner_instructor_id: user._id,
      status: 'draft',
    });
    await CourseUnit.create({ course_id: course._id, title: 'Existing', order: 1 });

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/units`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Unit Two' });

    expect(res.body.data.unit.order).toBe(2);
  });

  it('prevents IDOR: 403 if not the course owner', async () => {
    const owner = await createInstructorAndLogin({ email: 'owner@example.com' });
    const attacker = await createInstructorAndLogin({ email: 'attacker@example.com' });
    const course = await Course.create({
      ...validCoursePayload,
      owner_instructor_id: owner.user._id,
      status: 'draft',
    });

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/units`)
      .set('Authorization', `Bearer ${attacker.accessToken}`)
      .send({ title: 'Hacked Unit' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects with 409 REVIEW_IN_PROGRESS while course is pending_review', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const course = await Course.create({
      ...validCoursePayload,
      owner_instructor_id: user._id,
      status: 'pending_review',
    });

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/units`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Should Fail' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REVIEW_IN_PROGRESS');
  });

  it('rejects with 409 COURSE_NOT_EDITABLE when course is suspended', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const course = await Course.create({
      ...validCoursePayload,
      owner_instructor_id: user._id,
      status: 'suspended',
    });

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/units`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Should Fail' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COURSE_NOT_EDITABLE');
  });
});

describe('POST /api/v1/courses/:courseId/units/:unitId/content (Add Content)', () => {
  async function setupCourseWithUnit(overrides = {}) {
    const { accessToken, user } = await createInstructorAndLogin(overrides);
    const course = await Course.create({
      ...validCoursePayload,
      owner_instructor_id: user._id,
      status: 'draft',
    });
    const unit = await CourseUnit.create({ course_id: course._id, title: 'Unit 1', order: 1 });
    return { accessToken, user, course, unit };
  }

  it('adds video content successfully: Magic Bytes verified + stored in GridFS', async () => {
    const { accessToken, course, unit } = await setupCourseWithUnit();

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/units/${unit._id}/content`)
      .set('Authorization', `Bearer ${accessToken}`)
      .field('title', 'Lecture 1 Video')
      .field('content_type', 'video')
      .attach('file', fakeMp4(), 'lecture1.mp4');

    expect(res.status).toBe(201);
    expect(res.body.data.content.mime_type).toBe('video/mp4');
    expect(res.body.data.content.storage_path).toMatch(/^gridfs:\/\/course_files\//);
  });

  it('adds document (PDF) content successfully', async () => {
    const { accessToken, course, unit } = await setupCourseWithUnit();

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/units/${unit._id}/content`)
      .set('Authorization', `Bearer ${accessToken}`)
      .field('title', 'PDF Title')
      .field('content_type', 'document')
      .attach('file', fakePdf(), 'slides.pdf');

    expect(res.status).toBe(201);
    expect(res.body.data.content.mime_type).toBe('application/pdf');
  });

  it('adds link content with content_data.url, no file required', async () => {
    const { accessToken, course, unit } = await setupCourseWithUnit();

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/units/${unit._id}/content`)
      .set('Authorization', `Bearer ${accessToken}`)
      .field('title', 'Link Title')
      .field('content_type', 'link')
      .field('url', 'https://youtube.com/watch?v=example');

    expect(res.status).toBe(201);
    expect(res.body.data.content.content_data.url).toBe('https://youtube.com/watch?v=example');
  });

  it('adds text content with content_data.text', async () => {
    const { accessToken, course, unit } = await setupCourseWithUnit();

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/units/${unit._id}/content`)
      .set('Authorization', `Bearer ${accessToken}`)
      .field('title', 'Text Lesson Title')
      .field('content_type', 'text')
      .field('text', 'Written lesson content here.');

    expect(res.status).toBe(201);
    expect(res.body.data.content.content_data.text).toBe('Written lesson content here.');
  });

  it('rejects video content with 400 FILE_REQUIRED when no file attached', async () => {
    const { accessToken, course, unit } = await setupCourseWithUnit();

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/units/${unit._id}/content`)
      .set('Authorization', `Bearer ${accessToken}`)
      .field('title', 'Video Title')
      .field('content_type', 'video');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('FILE_REQUIRED');
  });

  it('rejects a file exceeding 50MB via normalized MulterError (LIMIT_FILE_SIZE), not 500', async () => {
    const { accessToken, course, unit } = await setupCourseWithUnit();
    const oversized = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.alloc(51 * 1024 * 1024, 0x00),
    ]);

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/units/${unit._id}/content`)
      .set('Authorization', `Bearer ${accessToken}`)
      .field('title', 'Huge File Title')
      .field('content_type', 'document')
      .attach('file', oversized, 'huge.pdf');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('LIMIT_FILE_SIZE');
  });

  it('rejects a file whose declared extension mismatches its real Magic Bytes', async () => {
    const { accessToken, course, unit } = await setupCourseWithUnit();

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/units/${unit._id}/content`)
      .set('Authorization', `Bearer ${accessToken}`)
      .field('title', 'Mismatched File Title')
      .field('content_type', 'document')
      .attach('file', fakeMp4(), 'fake.pdf');

    expect(res.status).toBe(400);
  });
});

describe('Review-state machine: published course edits trigger re-review', () => {
  it('updateCourse on a published course with a sensitive field change → reverts to draft (audit-logged), no auto CourseReviewRequest', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const course = await Course.create({
      ...validCoursePayload,
      owner_instructor_id: user._id,
      status: 'published',
      published_at: new Date(),
      completion_threshold: 0.7,
      content_complete: true,
    });

    const res = await request(app)
      .put(`/api/v1/courses/${course._id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ price: 49.99, course_type: 'paid' });

    expect(res.status).toBe(200);
    // revertToDraftOnPublishedEdit() only demotes to 'draft' + writes an
    // AuditLog entry — it deliberately does NOT auto-open a
    // CourseReviewRequest; the instructor must explicitly re-submit via
    // POST /courses/:id/submit-review, same as any other draft course.
    expect(res.body.data.course.status).toBe('draft');

    const reviewRequest = await CourseReviewRequest.findOne({ course_id: course._id });
    expect(reviewRequest).toBeNull();

    const auditEntry = await AuditLog.findOne({
      resource_type: 'Course',
      resource_id: course._id.toString(),
      action: 'COURSE_REVERTED_TO_DRAFT_ON_EDIT',
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry.metadata.change_type).toBe('FIELDS_UPDATED');
  });

  it('addUnit on a published course → reverts to draft (audit-logged) with change_type=UNIT_ADDED', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const course = await Course.create({
      ...validCoursePayload,
      owner_instructor_id: user._id,
      status: 'published',
      published_at: new Date(),
      completion_threshold: 0.7,
      content_complete: true,
    });

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/units`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'New Unit After Publish' });

    expect(res.status).toBe(201);
    const updatedCourse = await Course.findById(course._id);
    expect(updatedCourse.status).toBe('draft');

    const auditEntry = await AuditLog.findOne({
      resource_type: 'Course',
      resource_id: course._id.toString(),
      action: 'COURSE_REVERTED_TO_DRAFT_ON_EDIT',
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry.metadata.change_type).toBe('UNIT_ADDED');
  });
});

describe('Review-state machine: edits blocked while pending_review', () => {
  it('updateCourse rejected with 409 REVIEW_IN_PROGRESS', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const course = await Course.create({
      ...validCoursePayload,
      owner_instructor_id: user._id,
      status: 'pending_review',
    });

    const res = await request(app)
      .put(`/api/v1/courses/${course._id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Should Not Save' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REVIEW_IN_PROGRESS');

    const unchangedCourse = await Course.findById(course._id);
    expect(unchangedCourse.title).toBe(validCoursePayload.title);
  });
});

describe('POST /api/v1/courses/:courseId/cancel-review', () => {
  it('cancels the active review request and reverts course to draft', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const course = await Course.create({
      ...validCoursePayload,
      owner_instructor_id: user._id,
      status: 'pending_review',
    });
    await CourseReviewRequest.create({
      course_id: course._id,
      requested_by: user._id,
      status: 'pending_review',
      changes_snapshot: { change_type: 'FIELDS_UPDATED' },
    });

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/cancel-review`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.course.status).toBe('draft');

    const cancelledRequest = await CourseReviewRequest.findOne({ course_id: course._id });
    expect(cancelledRequest.status).toBe('cancelled');
  });

  it('rejects with 409 NO_ACTIVE_REVIEW when course is not pending_review', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const course = await Course.create({
      ...validCoursePayload,
      owner_instructor_id: user._id,
      status: 'draft',
    });

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/cancel-review`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_ACTIVE_REVIEW');
  });
});

describe('PUT /api/v1/courses/:courseId/units/:unitId (Update Unit)', () => {
  async function setupCourseWithUnit(overrides = {}) {
    const { accessToken, user } = await createInstructorAndLogin(overrides);
    const course = await Course.create({
      ...validCoursePayload,
      owner_instructor_id: user._id,
      status: overrides.courseStatus || 'draft',
      published_at: overrides.courseStatus === 'published' ? new Date() : null,
      content_complete: overrides.courseStatus === 'published' ? true : false,
    });
    const unit = await CourseUnit.create({
      course_id: course._id,
      title: 'Original Unit Title',
      desc: 'Original unit description',
      order: 1,
    });
    return { accessToken, user, course, unit };
  }

  it('updates unit title successfully', async () => {
    const { accessToken, course, unit } = await setupCourseWithUnit();

    const res = await request(app)
      .put(`/api/v1/courses/${course._id}/units/${unit._id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Updated Unit Title' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.unit.title).toBe('Updated Unit Title');
    expect(res.body.data.unit.desc).toBe('Original unit description');

    const updatedUnit = await CourseUnit.findById(unit._id);
    expect(updatedUnit.title).toBe('Updated Unit Title');
  });

  it('updates unit desc successfully', async () => {
    const { accessToken, course, unit } = await setupCourseWithUnit();

    const res = await request(app)
      .put(`/api/v1/courses/${course._id}/units/${unit._id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ desc: 'Updated unit description' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.unit.title).toBe('Original Unit Title');
    expect(res.body.data.unit.desc).toBe('Updated unit description');
  });

  it('updates both title and desc simultaneously', async () => {
    const { accessToken, course, unit } = await setupCourseWithUnit();

    const res = await request(app)
      .put(`/api/v1/courses/${course._id}/units/${unit._id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'New Title',
        desc: 'New Description',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.unit.title).toBe('New Title');
    expect(res.body.data.unit.desc).toBe('New Description');
  });

  it('rejects with 400 when no fields are provided', async () => {
    const { accessToken, course, unit } = await setupCourseWithUnit();

    const res = await request(app)
      .put(`/api/v1/courses/${course._id}/units/${unit._id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('rejects with 400 when title exceeds 200 characters', async () => {
    const { accessToken, course, unit } = await setupCourseWithUnit();
    const longTitle = 'A'.repeat(201);

    const res = await request(app)
      .put(`/api/v1/courses/${course._id}/units/${unit._id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: longTitle });

    expect(res.status).toBe(400);
  });

  it('rejects with 400 when title is empty string', async () => {
    const { accessToken, course, unit } = await setupCourseWithUnit();

    const res = await request(app)
      .put(`/api/v1/courses/${course._id}/units/${unit._id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: '   ' });

    expect(res.status).toBe(400);
  });

  it('prevents IDOR: rejects with 403 if user is not the course owner', async () => {
    const owner = await setupCourseWithUnit({ email: 'owner@example.com' });
    const attacker = await createInstructorAndLogin({ email: 'attacker@example.com' });

    const res = await request(app)
      .put(`/api/v1/courses/${owner.course._id}/units/${owner.unit._id}`)
      .set('Authorization', `Bearer ${attacker.accessToken}`)
      .send({ title: 'Hacked Title' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');

    const unchangedUnit = await CourseUnit.findById(owner.unit._id);
    expect(unchangedUnit.title).toBe('Original Unit Title');
  });

  it('rejects with 404 when unit does not exist', async () => {
    const { accessToken, course } = await setupCourseWithUnit();
    const fakeUnitId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .put(`/api/v1/courses/${course._id}/units/${fakeUnitId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Should Fail' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('UNIT_NOT_FOUND');
  });

  it('rejects with 404 when course does not exist', async () => {
    const { accessToken } = await createInstructorAndLogin();
    const fakeCourseId = new mongoose.Types.ObjectId();
    const fakeUnitId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .put(`/api/v1/courses/${fakeCourseId}/units/${fakeUnitId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Should Fail' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COURSE_NOT_FOUND');
  });

  it('rejects with 404 when unit belongs to a different course', async () => {
    const { accessToken, user } = await createInstructorAndLogin();

    const course1 = await Course.create({
      ...validCoursePayload,
      owner_instructor_id: user._id,
      status: 'draft',
    });
    const course2 = await Course.create({
      ...validCoursePayload,
      title: 'Different Course',
      owner_instructor_id: user._id,
      status: 'draft',
    });

    const unitInCourse1 = await CourseUnit.create({
      course_id: course1._id,
      title: 'Unit in Course 1',
      desc: 'Description',
      order: 1,
    });

    const res = await request(app)
      .put(`/api/v1/courses/${course2._id}/units/${unitInCourse1._id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Should Fail' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('UNIT_NOT_FOUND');
  });

  it('rejects with 409 REVIEW_IN_PROGRESS when course is pending_review', async () => {
    const { accessToken, course, unit } = await setupCourseWithUnit({
      courseStatus: 'pending_review',
    });

    const res = await request(app)
      .put(`/api/v1/courses/${course._id}/units/${unit._id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Should Fail' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REVIEW_IN_PROGRESS');
  });

  it('rejects with 409 COURSE_NOT_EDITABLE when course is suspended', async () => {
    const { accessToken, course, unit } = await setupCourseWithUnit({ courseStatus: 'suspended' });

    const res = await request(app)
      .put(`/api/v1/courses/${course._id}/units/${unit._id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Should Fail' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COURSE_NOT_EDITABLE');
  });

  it('rejects with 409 COURSE_NOT_EDITABLE when course is archived', async () => {
    const { accessToken, course, unit } = await setupCourseWithUnit({ courseStatus: 'archived' });

    const res = await request(app)
      .put(`/api/v1/courses/${course._id}/units/${unit._id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Should Fail' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COURSE_NOT_EDITABLE');
  });

  it('reverts to draft (audit-logged) when updating unit on a published course', async () => {
    const { accessToken, course, unit } = await setupCourseWithUnit({ courseStatus: 'published' });

    const res = await request(app)
      .put(`/api/v1/courses/${course._id}/units/${unit._id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Updated Title on Published Course' });

    expect(res.status).toBe(200);
    expect(res.body.data.unit.title).toBe('Updated Title on Published Course');

    const updatedCourse = await Course.findById(course._id);
    expect(updatedCourse.status).toBe('draft');

    const auditEntry = await AuditLog.findOne({
      resource_type: 'Course',
      resource_id: course._id.toString(),
      action: 'COURSE_REVERTED_TO_DRAFT_ON_EDIT',
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry.metadata.change_type).toBe('UNIT_UPDATED');
    expect(auditEntry.metadata.new_title).toBe('Updated Title on Published Course');
  });

  it('requires KYC verification for unit update', async () => {
    const { accessToken, course, unit } = await setupCourseWithUnit({
      email: 'nokyc@example.com',
      kyc_status: 'not_submitted',
    });

    const res = await request(app)
      .put(`/api/v1/courses/${course._id}/units/${unit._id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Should Fail' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('KYC_NOT_VERIFIED');
  });

  it('requires MFA for unit update', async () => {
    const { accessToken, course, unit } = await setupCourseWithUnit({
      email: 'nomfa@example.com',
      mfa_enabled: false,
    });

    const res = await request(app)
      .put(`/api/v1/courses/${course._id}/units/${unit._id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Should Fail' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MFA_REQUIRED');
  });
});

describe('GET /api/v1/courses/:courseId/units/:unitId (Get Unit Details)', () => {
  async function setupCourseWithUnitAndContent(overrides = {}) {
    const { accessToken, user } = await createInstructorAndLogin(overrides);
    const course = await Course.create({
      ...validCoursePayload,
      owner_instructor_id: user._id,
      status: overrides.courseStatus || 'draft',
    });
    const unit = await CourseUnit.create({
      course_id: course._id,
      title: 'Test Unit',
      desc: 'Test unit description',
      order: 1,
    });
    await CourseContent.create({
      course_id: course._id,
      unit_id: unit._id,
      title: 'Intro to course',
      owner_instructor_id: user._id,
      content_type: 'text',
      content_data: { text: 'Lesson 1 content' },
      order: 1,
    });
    await CourseContent.create({
      course_id: course._id,
      unit_id: unit._id,
      title: 'Intro to course 2',
      owner_instructor_id: user._id,
      content_type: 'link',
      content_data: { url: 'https://example.com/video' },
      order: 2,
    });
    return { accessToken, user, course, unit };
  }

  it('fetches unit details with all content items successfully', async () => {
    const { accessToken, course, unit } = await setupCourseWithUnitAndContent();

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/units/${unit._id}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.unit).toBeDefined();
    expect(res.body.data.unit._id.toString()).toBe(unit._id.toString());
    expect(res.body.data.unit.title).toBe('Test Unit');
    expect(res.body.data.unit.desc).toBe('Test unit description');
    expect(res.body.data.unit.content).toBeInstanceOf(Array);
    expect(res.body.data.unit.content).toHaveLength(2);
    expect(res.body.data.unit.content_count).toBe(2);
  });

  it('returns content items in correct order', async () => {
    const { accessToken, course, unit } = await setupCourseWithUnitAndContent();

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/units/${unit._id}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    const content = res.body.data.unit.content;
    expect(content[0].order).toBe(1);
    expect(content[0].content_type).toBe('text');
    expect(content[0].content_data.text).toBe('Lesson 1 content');
    expect(content[1].order).toBe(2);
    expect(content[1].content_type).toBe('link');
    expect(content[1].content_data.url).toBe('https://example.com/video');
  });

  it('returns empty content array for unit with no content', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const course = await Course.create({
      ...validCoursePayload,
      owner_instructor_id: user._id,
      status: 'draft',
    });
    const emptyUnit = await CourseUnit.create({
      course_id: course._id,
      title: 'Empty Unit',
      desc: 'No content here',
      order: 1,
    });

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/units/${emptyUnit._id}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.unit.content).toEqual([]);
    expect(res.body.data.unit.content_count).toBe(0);
  });

  it('prevents IDOR: rejects with 403 if user is not the course owner', async () => {
    const owner = await setupCourseWithUnitAndContent({ email: 'owner@example.com' });
    const attacker = await createInstructorAndLogin({ email: 'attacker@example.com' });

    const res = await request(app)
      .get(`/api/v1/courses/${owner.course._id}/units/${owner.unit._id}`)
      .set('Authorization', `Bearer ${attacker.accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects with 404 when unit does not exist', async () => {
    const { accessToken, course } = await setupCourseWithUnitAndContent();
    const fakeUnitId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/units/${fakeUnitId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('UNIT_NOT_FOUND');
  });

  it('rejects with 404 when course does not exist', async () => {
    const { accessToken } = await createInstructorAndLogin();
    const fakeCourseId = new mongoose.Types.ObjectId();
    const fakeUnitId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .get(`/api/v1/courses/${fakeCourseId}/units/${fakeUnitId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COURSE_NOT_FOUND');
  });

  it('rejects with 404 when unit belongs to a different course', async () => {
    const { accessToken, user } = await createInstructorAndLogin();

    const course1 = await Course.create({
      ...validCoursePayload,
      owner_instructor_id: user._id,
      status: 'draft',
    });
    const course2 = await Course.create({
      ...validCoursePayload,
      title: 'Different Course',
      owner_instructor_id: user._id,
      status: 'draft',
    });

    const unitInCourse1 = await CourseUnit.create({
      course_id: course1._id,
      title: 'Unit in Course 1',
      desc: 'Description',
      order: 1,
    });

    const res = await request(app)
      .get(`/api/v1/courses/${course2._id}/units/${unitInCourse1._id}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('UNIT_NOT_FOUND');
  });

  it('returns 404 for unauthenticated access to draft course units (guest preview restricted to published courses)', async () => {
    const { course, unit } = await setupCourseWithUnitAndContent();

    const res = await request(app).get(`/api/v1/courses/${course._id}/units/${unit._id}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 for student access to non-published draft course units', async () => {
    const passwordHash = await hashPassword(PLAIN_PASSWORD);
    const student = await User.create({
      full_name: 'Student User',
      email: 'student@example.com',
      password_hash: passwordHash,
      birth_date: new Date('2000-01-01'),
      role: 'Student',
      status: 'active',
      email_verified_at: new Date(),
      mfa_enabled: true,
      privacy_consent: {
        policy_version: 'v1.0',
        accepted_at: new Date(),
        ip: '127.0.0.1',
        user_agent: 'jest',
      },
    });

    const session = await Session.create({
      user_id: student._id,
      device_fingerprint: 'test-fingerprint',
      ip_address: '127.0.0.1',
      user_agent: 'jest',
      mfa_verified: false,
      status: 'active',
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const studentToken = signAccessToken({
      userId: student._id,
      sessionId: session._id,
    });

    const { course, unit } = await setupCourseWithUnitAndContent();

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/units/${unit._id}`)
      .set('Authorization', `Bearer ${studentToken}`);

    expect(res.status).toBe(404);
  });

  it('includes content metadata (mime_type, size_bytes) for file-backed content', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const course = await Course.create({
      ...validCoursePayload,
      owner_instructor_id: user._id,
      status: 'draft',
    });
    const unit = await CourseUnit.create({
      course_id: course._id,
      title: 'Unit with File',
      desc: 'Has file content',
      order: 1,
    });

    await CourseContent.create({
      course_id: course._id,
      unit_id: unit._id,
      owner_instructor_id: user._id,
      title: 'Intro to course',
      content_type: 'video',
      storage_path: 'gridfs://course_files/fakeid123',
      mime_type: 'video/mp4',
      size_bytes: 1024000,
      order: 1,
    });

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/units/${unit._id}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    const content = res.body.data.unit.content[0];
    expect(content.mime_type).toBe('video/mp4');
    expect(content.size_bytes).toBe(1024000);
    expect(content.storage_path).toBeUndefined();
  });
});

describe('POST content — enriched response with unit_content', () => {
  it('addContent returns both the new item AND the full unit content list', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const course = await Course.create({
      ...validCoursePayload,
      owner_instructor_id: user._id,
      status: 'draft',
    });
    const unit = await CourseUnit.create({ course_id: course._id, title: 'Unit 1', order: 1 });
    await CourseContent.create({
      course_id: course._id,
      unit_id: unit._id,
      title: 'Intro to course',
      owner_instructor_id: user._id,
      content_type: 'text',
      content_data: { text: 'Existing lesson' },
      order: 1,
    });

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/units/${unit._id}/content`)
      .set('Authorization', `Bearer ${accessToken}`)
      .field('title', 'New Lesson Title')
      .field('content_type', 'text')
      .field('text', 'New lesson');

    expect(res.status).toBe(201);
    expect(res.body.data.unit_content).toHaveLength(2); // existing + new, in order
    expect(res.body.data.unit_content[1].content_data.text).toBe('New lesson');
  });
});
