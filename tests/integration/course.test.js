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
const { hashPassword } = require('../../src/utils/crypto');
const redisClient = require('../../src/config/redis');
const { signAccessToken } = require('../../src/utils/jwt');
const CourseUnit = require('../../src/models/CourseUnit');
const CourseContent = require('../../src/models/CourseContent');

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
    CourseUnit.deleteMany({}),
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
  if (redisClient.isOpen) await redisClient.quit();
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
  it('submits a draft course for review successfully when content exists', async () => {
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
      content_type: 'text',
      content_data: { text: 'Intro text' },
      order: 1,
    });

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/submit-review`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    const updatedCourse = await Course.findById(course._id);
    expect(updatedCourse.status).toBe('pending_review');
    expect(updatedCourse.content_complete).toBe(true);
  });

  it('rejects submission with 400 COURSE_CONTENT_INCOMPLETE when the course has no content', async () => {
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
      .send({ title: 'Unit One', order: 999 }); // order must be ignored — not in schema anyway

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
      .field('content_type', 'document')
      .attach('file', fakeMp4(), 'fake.pdf'); // real mp4 bytes, .pdf extension

    expect(res.status).toBe(400);
    // reason code is one of the generic FILE_TYPE_NOT_ALLOWED / EXTENSION_MISMATCH —
    // exact code depends on which check fires first inside validateUploadedFile
  });
});

describe('Review-state machine: published course edits trigger re-review', () => {
  it('updateCourse on a published course with a sensitive field change → pending_review + new CourseReviewRequest', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const course = await Course.create({
      ...validCoursePayload,
      owner_instructor_id: user._id,
      status: 'published',
      published_at: new Date(),
    });

    const res = await request(app)
      .put(`/api/v1/courses/${course._id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ price: 49.99, course_type: 'paid' });

    expect(res.status).toBe(200);
    expect(res.body.data.course.status).toBe('pending_review');

    const reviewRequest = await CourseReviewRequest.findOne({ course_id: course._id });
    expect(reviewRequest).not.toBeNull();
    expect(reviewRequest.changes_snapshot.change_type).toBe('FIELDS_UPDATED');
  });

  it('addUnit on a published course → triggers pending_review with change_type=UNIT_ADDED', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const course = await Course.create({
      ...validCoursePayload,
      owner_instructor_id: user._id,
      status: 'published',
      published_at: new Date(),
    });

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/units`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'New Unit After Publish' });

    expect(res.status).toBe(201);
    const updatedCourse = await Course.findById(course._id);
    expect(updatedCourse.status).toBe('pending_review');

    const reviewRequest = await CourseReviewRequest.findOne({ course_id: course._id });
    expect(reviewRequest.changes_snapshot.change_type).toBe('UNIT_ADDED');
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
    expect(unchangedCourse.title).toBe(validCoursePayload.title); // confirms no partial write happened
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
