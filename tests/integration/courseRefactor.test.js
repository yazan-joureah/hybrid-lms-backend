// tests/integration/courseRefactor.test.js
/**
 * Regression + edge-case coverage for the course-module refactor:
 * malformed ObjectIds must return 400 (never 500), and every
 * ownership-guarded mutation must consistently return 403 FORBIDDEN
 * for non-owners — now that they all share loadOwnedCourse().
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const User = require('../../src/models/User');
const Course = require('../../src/models/Course');
const CourseUnit = require('../../src/models/CourseUnit');
const CourseContent = require('../../src/models/CourseContent');
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
    Session.deleteMany({}),
  ]);
  if (redisClient.isOpen) await redisClient.flushdb();
});

afterAll(async () => {
  await mongoose.connection.close();
  if (redisClient.isOpen) await redisClient.quit();
});

async function createInstructorAndLogin(overrides = {}) {
  const passwordHash = await hashPassword(PLAIN_PASSWORD);
  const user = await User.create({
    full_name: overrides.full_name || 'Instructor',
    email: overrides.email || `instructor-${Date.now()}-${Math.random()}@example.com`,
    password_hash: passwordHash,
    birth_date: new Date('1990-01-01'),
    role: 'Instructor',
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

const basePayload = {
  title: 'Refactor Coverage Course',
  description: 'Course used to validate the shared ownership helper.',
  category: 'Technology & Computer Science',
  course_type: 'free',
  is_synchronous: false,
};

describe('Malformed ObjectId handling (loadOwnedCourse / toObjectId)', () => {
  it('returns 400 (not 500) when courseId is not a valid ObjectId on PUT /courses/:courseId', async () => {
    const { accessToken } = await createInstructorAndLogin();

    const res = await request(app)
      .put('/api/v1/courses/not-a-valid-id')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'New Title' });

    expect(res.status).toBe(400);
  });

  it('returns 400 (not 500) when unitId is malformed on DELETE unit', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const course = await Course.create({
      ...basePayload,
      owner_instructor_id: user._id,
      status: 'draft',
    });

    const res = await request(app)
      .delete(`/api/v1/courses/${course._id}/units/xyz-invalid`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(400);
  });

  it('returns 400 (not 500) when courseId is malformed on unit reorder', async () => {
    const { accessToken } = await createInstructorAndLogin();

    const res = await request(app)
      .patch('/api/v1/courses/bad-id/units/reorder')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ordered_unit_ids: [] });

    expect(res.status).toBe(400);
  });
});

describe('Consistent 403 FORBIDDEN across all owner-guarded mutations', () => {
  async function setupOwnedCourseWithUnit() {
    const owner = await createInstructorAndLogin({ email: 'owner-refactor@example.com' });
    const attacker = await createInstructorAndLogin({ email: 'attacker-refactor@example.com' });
    const course = await Course.create({
      ...basePayload,
      owner_instructor_id: owner.user._id,
      status: 'draft',
    });
    const unit = await CourseUnit.create({ course_id: course._id, title: 'Unit 1', order: 1 });
    return { owner, attacker, course, unit };
  }

  it('DELETE unit by non-owner → 403 FORBIDDEN (previously reachable inconsistently)', async () => {
    const { attacker, course, unit } = await setupOwnedCourseWithUnit();

    const res = await request(app)
      .delete(`/api/v1/courses/${course._id}/units/${unit._id}`)
      .set('Authorization', `Bearer ${attacker.accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');

    const stillExists = await CourseUnit.findById(unit._id);
    expect(stillExists).not.toBeNull();
  });

  it('PATCH units/reorder by non-owner → 403 FORBIDDEN', async () => {
    const { attacker, course, unit } = await setupOwnedCourseWithUnit();

    const res = await request(app)
      .patch(`/api/v1/courses/${course._id}/units/reorder`)
      .set('Authorization', `Bearer ${attacker.accessToken}`)
      .send({ ordered_unit_ids: [unit._id.toString()] });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('DELETE course by non-owner → 403 FORBIDDEN, course untouched', async () => {
    const { attacker, course } = await setupOwnedCourseWithUnit();

    const res = await request(app)
      .delete(`/api/v1/courses/${course._id}`)
      .set('Authorization', `Bearer ${attacker.accessToken}`);

    expect(res.status).toBe(403);
    const stillExists = await Course.findById(course._id);
    expect(stillExists).not.toBeNull();
  });

  it('GET course roster (students) by non-owner → 403 FORBIDDEN', async () => {
    const { attacker, course } = await setupOwnedCourseWithUnit();

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/students`)
      .set('Authorization', `Bearer ${attacker.accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('Conditional content validation (contentCreateSchema refine)', () => {
  it('rejects link content missing url at the Zod layer (400 before hitting the service)', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const course = await Course.create({
      ...basePayload,
      owner_instructor_id: user._id,
      status: 'draft',
    });
    const unit = await CourseUnit.create({ course_id: course._id, title: 'Unit 1', order: 1 });

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/units/${unit._id}/content`)
      .set('Authorization', `Bearer ${accessToken}`)
      .field('title', 'Missing URL')
      .field('content_type', 'link');

    expect(res.status).toBe(400);
  });

  it('rejects text content missing text at the Zod layer', async () => {
    const { accessToken, user } = await createInstructorAndLogin();
    const course = await Course.create({
      ...basePayload,
      owner_instructor_id: user._id,
      status: 'draft',
    });
    const unit = await CourseUnit.create({ course_id: course._id, title: 'Unit 1', order: 1 });

    const res = await request(app)
      .post(`/api/v1/courses/${course._id}/units/${unit._id}/content`)
      .set('Authorization', `Bearer ${accessToken}`)
      .field('title', 'Missing Text')
      .field('content_type', 'text');

    expect(res.status).toBe(400);
  });
});

describe('Progress module reachable via the unified courseService barrel', () => {
  it('progress-summary still resolves correctly after relocating progress.service.js', async () => {
    const { user } = await createInstructorAndLogin();
    const course = await Course.create({
      ...basePayload,
      owner_instructor_id: user._id,
      status: 'published',
      completion_threshold: 0.7,
    });

    const student = await createInstructorAndLogin({ email: 'student-refactor@example.com' });
    await User.findByIdAndUpdate(student.user._id, { role: 'Student' });

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/progress-summary`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    // Not enrolled → 403 NOT_ENROLLED is the correct, expected outcome —
    // proves the route resolved through the relocated service without a 500.
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_ENROLLED');
  });
});
