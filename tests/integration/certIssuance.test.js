// tests/integration/certIssuance.test.js
//
// UC-CERT-01 (Issue Certificate) — the critical guarantee: no certificate
// is ever issued without KYC verified + MFA enabled, even when the course
// is fully completed. Also covers UC-CERT-07's opportunistic retry, which
// recovers a blocked issuance once identity is later verified.

require('../helpers/setupCertSigningKeys');

const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../../src/models/User');
const Course = require('../../src/models/Course');
const Enrollment = require('../../src/models/Enrollment');
const Certificate = require('../../src/models/certificate.model');
const AuditLog = require('../../src/models/AuditLog');
const { issueCertificate } = require('../../src/services/cert/certificate.service');
const { listMyCertificates } = require('../../src/services/cert/certificateList.service');

const fakeReq = { ip: '127.0.0.1', get: () => 'jest-test-agent' };

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    const baseUri =
      process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/hybrid_lms';
    const testUri = baseUri.endsWith('_test') ? baseUri : `${baseUri}_test`;
    await mongoose.connect(testUri);
  }
}, 20000);

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Course.deleteMany({}),
    Enrollment.deleteMany({}),
    Certificate.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.connection.close();
});

async function createUser(overrides = {}) {
  return User.create({
    full_name: 'Test Student',
    email: `${Date.now()}-${Math.random()}@example.com`,
    password_hash: 'irrelevant-hash',
    birth_date: new Date('2000-01-01'),
    role: 'Student',
    status: 'active',
    kyc_status: 'not_submitted',
    mfa_enabled: false,
    ...overrides,
  });
}

async function createInstructor() {
  return createUser({ role: 'Instructor', kyc_status: 'verified', mfa_enabled: true });
}

async function createCourse(instructorId, overrides = {}) {
  return Course.create({
    owner_instructor_id: instructorId,
    title: 'Test Course',
    description: 'A course for testing',
    category: 'Technology & Computer Science',
    course_type: 'free',
    status: 'published',
    ...overrides,
  });
}

async function createCompletedEnrollment(studentId, courseId) {
  return Enrollment.create({
    course_id: courseId,
    student_id: studentId,
    status: 'completed',
    confirmed_by_student: true,
    completed_at: new Date(),
  });
}

describe('UC-CERT-01 — issueCertificate: identity gate', () => {
  it('BLOCKS issuance when course is completed but KYC is not verified — no Certificate is ever created', async () => {
    const instructor = await createInstructor();
    const course = await createCourse(instructor._id);
    const student = await createUser({ kyc_status: 'not_submitted', mfa_enabled: true });
    await createCompletedEnrollment(student._id, course._id);

    await expect(
      issueCertificate({ studentId: student._id, courseId: course._id, req: fakeReq })
    ).rejects.toMatchObject({ code: 'KYC_NOT_VERIFIED' });

    const certs = await Certificate.find({ student_id: student._id });
    expect(certs).toHaveLength(0);
  });

  it('BLOCKS issuance when course is completed but MFA is not enabled — no Certificate is ever created', async () => {
    const instructor = await createInstructor();
    const course = await createCourse(instructor._id);
    const student = await createUser({ kyc_status: 'verified', mfa_enabled: false });
    await createCompletedEnrollment(student._id, course._id);

    await expect(
      issueCertificate({ studentId: student._id, courseId: course._id, req: fakeReq })
    ).rejects.toMatchObject({ code: 'MFA_REQUIRED' });

    const certs = await Certificate.find({ student_id: student._id });
    expect(certs).toHaveLength(0);
  });

  it('BLOCKS issuance when enrollment is not completed, even with KYC+MFA satisfied', async () => {
    const instructor = await createInstructor();
    const course = await createCourse(instructor._id);
    const student = await createUser({ kyc_status: 'verified', mfa_enabled: true });
    await Enrollment.create({
      course_id: course._id,
      student_id: student._id,
      status: 'active', // not completed
      confirmed_by_student: true,
    });

    await expect(
      issueCertificate({ studentId: student._id, courseId: course._id, req: fakeReq })
    ).rejects.toMatchObject({ code: 'ENROLLMENT_NOT_COMPLETED' });

    const certs = await Certificate.find({ student_id: student._id });
    expect(certs).toHaveLength(0);
  });

  it('SUCCEEDS and produces a certificate record (without stored signature) when all gates pass', async () => {
    const instructor = await createInstructor();
    const course = await createCourse(instructor._id);
    const student = await createUser({ kyc_status: 'verified', mfa_enabled: true });
    await createCompletedEnrollment(student._id, course._id);

    const result = await issueCertificate({
      studentId: student._id,
      courseId: course._id,
      req: fakeReq,
    });

    expect(result.success).toBe(true);
    const cert = result.data.certificate;
    expect(cert.status).toBe('active');
    expect(cert.student_id.toString()).toBe(String(student._id));
    expect(cert.qr_code_image).toBeInstanceOf(Buffer);
    // REMOVED: signature and encrypted_content expectations – no longer stored
    // expect(cert.signature).toEqual(expect.any(String));
    // expect(cert.encrypted_content).toBeInstanceOf(Buffer);

    const auditEntry = await AuditLog.findOne({ action: 'CERTIFICATE_ISSUED' });
    expect(auditEntry).not.toBeNull();
  });
});

describe('UC-CERT-07 retryPendingIssuances — recovers a blocked issuance once identity is verified', () => {
  it('no certificate exists while KYC missing; after KYC+MFA fixed, visiting My Certificates issues it', async () => {
    const instructor = await createInstructor();
    const course = await createCourse(instructor._id);
    const student = await createUser({ kyc_status: 'not_submitted', mfa_enabled: false });
    await createCompletedEnrollment(student._id, course._id);

    // Visiting the list while still unverified — retry short-circuits, no cert.
    let listResult = await listMyCertificates({ studentId: student._id, req: fakeReq });
    expect(listResult.data.certificates).toHaveLength(0);

    // Student completes KYC + enables MFA.
    await User.updateOne(
      { _id: student._id },
      { $set: { kyc_status: 'verified', mfa_enabled: true } }
    );

    // Next visit to the list triggers the opportunistic retry.
    listResult = await listMyCertificates({ studentId: student._id, req: fakeReq });
    expect(listResult.data.certificates).toHaveLength(1);
    expect(listResult.data.certificates[0].status).toBe('active');
  });
});
