// tests/integration/certRoutes.test.js
// End-to-end HTTP coverage for certRoutes.js — confirms requireAuth /
// requireRole / requireVerifiedIdentity are correctly wired at the route
// level (not just the service-level guarantees already covered above),
// plus the public, unauthenticated verify endpoint and its open CORS header.

require('../helpers/setupCertSigningKeys');

const request = require('supertest');
const mongoose = require('mongoose');
require('dotenv').config();
const app = require('../../src/app');
const User = require('../../src/models/User');
const Course = require('../../src/models/Course');
const Enrollment = require('../../src/models/Enrollment');
const Certificate = require('../../src/models/certificate.model');
// REMOVED: const CertificateTemplate = require('../../src/models/certificateTemplate.model');
const redisClient = require('../../src/config/redis');
const { signAccessToken } = require('../../src/utils/jwt');
const { issueCertificate } = require('../../src/services/cert/certificate.service');

function tokenFor(user) {
  return signAccessToken({ userId: user._id, sessionId: 'fake-session-id-for-tests' });
}

async function createUser(overrides = {}) {
  return User.create({
    full_name: 'Test User',
    email: `${Date.now()}-${Math.random()}@example.com`,
    password_hash: 'irrelevant-hash',
    birth_date: new Date('2000-01-01'),
    role: 'Student',
    status: 'active',
    kyc_status: 'verified',
    mfa_enabled: true,
    ...overrides,
  });
}

async function createCourse(instructorId) {
  return Course.create({
    owner_instructor_id: instructorId,
    title: 'Route Test Course',
    description: 'desc',
    category: 'Technology & Computer Science',
    course_type: 'free',
    status: 'published',
  });
}

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
    Certificate.deleteMany({}),
    // REMOVED: CertificateTemplate.deleteMany({}),
  ]);
  await redisClient.flushdb();
});

afterAll(async () => {
  await mongoose.connection.close();
  await redisClient.quit();
});

describe('GET /api/v1/certificates/verify/:certificateId — public, no auth', () => {
  it('returns 200 with status=valid for a real issued certificate, with no Authorization header', async () => {
    const instructor = await createUser({ role: 'Instructor' });
    const course = await createCourse(instructor._id);
    const student = await createUser();
    await Enrollment.create({
      course_id: course._id,
      student_id: student._id,
      status: 'completed',
      confirmed_by_student: true,
    });
    const { data } = await issueCertificate({
      studentId: student._id,
      courseId: course._id,
      req: { ip: '127.0.0.1', get: () => 'jest' },
    });

    const res = await request(app).get(
      `/api/v1/certificates/verify/${data.certificate.certificate_id}`
    );

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('valid');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('returns 200 with status=not_found for an unknown certificate id, still with no auth', async () => {
    const res = await request(app).get(
      '/api/v1/certificates/verify/00000000-0000-0000-0000-000000000000'
    );
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('not_found');
  });
});

describe('GET /api/v1/certificates/my-certificates — requires auth + role + verified identity', () => {
  it('no Authorization header → 401', async () => {
    const res = await request(app).get('/api/v1/certificates/my-certificates');
    expect(res.status).toBe(401);
  });

  it('Instructor role → 403 (Student-only route)', async () => {
    const instructor = await createUser({ role: 'Instructor' });
    const res = await request(app)
      .get('/api/v1/certificates/my-certificates')
      .set('Authorization', `Bearer ${tokenFor(instructor)}`);
    expect(res.status).toBe(403);
  });

  it('Student without KYC verified → 403 KYC_NOT_VERIFIED (route-level requireVerifiedIdentity)', async () => {
    const student = await createUser({ kyc_status: 'not_submitted', mfa_enabled: true });
    const res = await request(app)
      .get('/api/v1/certificates/my-certificates')
      .set('Authorization', `Bearer ${tokenFor(student)}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('KYC_NOT_VERIFIED');
  });

  it('fully verified Student → 200 with an empty list when no certificates exist', async () => {
    const student = await createUser();
    const res = await request(app)
      .get('/api/v1/certificates/my-certificates')
      .set('Authorization', `Bearer ${tokenFor(student)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.certificates).toEqual([]);
  });
});

describe('GET /api/v1/certificates/download/:courseId — requires auth + role + verified identity', () => {
  it('no Authorization header → 401', async () => {
    const res = await request(app).get(
      `/api/v1/certificates/download/${new mongoose.Types.ObjectId()}`
    );
    expect(res.status).toBe(401);
  });

  it('Student with no certificate for that course → 404 CERTIFICATE_NOT_FOUND', async () => {
    const student = await createUser();
    const res = await request(app)
      .get(`/api/v1/certificates/download/${new mongoose.Types.ObjectId()}`)
      .set('Authorization', `Bearer ${tokenFor(student)}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CERTIFICATE_NOT_FOUND');
  });

  it('fully verified Student downloads their real certificate → 200 with base64 QR image', async () => {
    const instructor = await createUser({ role: 'Instructor' });
    const course = await createCourse(instructor._id);
    const student = await createUser();
    await Enrollment.create({
      course_id: course._id,
      student_id: student._id,
      status: 'completed',
      confirmed_by_student: true,
    });
    await issueCertificate({
      studentId: student._id,
      courseId: course._id,
      req: { ip: '127.0.0.1', get: () => 'jest' },
    });

    const res = await request(app)
      .get(`/api/v1/certificates/download/${course._id}`)
      .set('Authorization', `Bearer ${tokenFor(student)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.qr_code_image_base64).toEqual(expect.any(String));
  });
});

// ===== REMOVED: Entire "Certificate Templates routes — SuperAdmin only" describe block =====
