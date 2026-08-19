// tests/integration/certUnitsAndTemplates.test.js
// SF-CERT-02 (QR) + SF-CERT-03 (Sign/Verify) unit-level coverage,
// UC-CERT-06 (Manage Certificate Templates), and Certificate model's
// referential-integrity guard.

require('../helpers/setupCertSigningKeys');

const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../../src/models/User');
const Certificate = require('../../src/models/certificate.model');
const CertificateTemplate = require('../../src/models/certificateTemplate.model');
const AuditLog = require('../../src/models/AuditLog');
const {
  createCertificateQrCode,
  recomputeVerificationHash,
} = require('../../src/services/cert/qrGeneration.service');
const {
  signAndEncryptCertificate,
  verifyCertificateSignature,
} = require('../../src/services/cert/signing.service');
const {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} = require('../../src/services/cert/certificate.service');

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
    Certificate.deleteMany({}),
    CertificateTemplate.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.connection.close();
});

async function createUser(overrides = {}) {
  return User.create({
    full_name: 'Test User',
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

// ---------------------------------------------------------------------------
// SF-CERT-02 — QR generation
// ---------------------------------------------------------------------------
describe('SF-CERT-02 — createCertificateQrCode / recomputeVerificationHash', () => {
  const baseParams = {
    certificateId: 'fixed-test-cert-id',
    studentNameSnapshot: 'Jane Doe',
    courseTitleSnapshot: 'Intro to Security',
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  it('produces a non-empty PNG buffer and a hex-encoded hash', async () => {
    const { qrCodeImage, verificationHash, verificationUrl } =
      await createCertificateQrCode(baseParams);

    expect(qrCodeImage).toBeInstanceOf(Buffer);
    expect(qrCodeImage.length).toBeGreaterThan(0);
    // PNG magic bytes
    expect(qrCodeImage.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    expect(verificationHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verificationUrl).toContain(baseParams.certificateId);
  });

  it('recomputeVerificationHash is deterministic and matches the value from createCertificateQrCode', async () => {
    const { verificationHash } = await createCertificateQrCode(baseParams);
    const recomputed = recomputeVerificationHash(baseParams);
    expect(recomputed).toBe(verificationHash);
  });

  it('recomputeVerificationHash changes if ANY snapshot field changes (binds all fields)', () => {
    const original = recomputeVerificationHash(baseParams);
    const changedName = recomputeVerificationHash({
      ...baseParams,
      studentNameSnapshot: 'John Doe',
    });
    const changedCourse = recomputeVerificationHash({
      ...baseParams,
      courseTitleSnapshot: 'Different Course',
    });
    const changedDate = recomputeVerificationHash({
      ...baseParams,
      issuedAt: new Date('2026-02-01T00:00:00.000Z'),
    });

    expect(changedName).not.toBe(original);
    expect(changedCourse).not.toBe(original);
    expect(changedDate).not.toBe(original);
  });

  it('rejects when required fields are missing', async () => {
    await expect(
      createCertificateQrCode({ ...baseParams, certificateId: undefined })
    ).rejects.toMatchObject({ code: 'QR_GENERATION_MISSING_FIELDS' });
  });
});

// ---------------------------------------------------------------------------
// SF-CERT-03 — Sign & Encrypt / Verify
// ---------------------------------------------------------------------------
describe('SF-CERT-03 — signAndEncryptCertificate / verifyCertificateSignature', () => {
  it('produces a signature that verifies successfully against the SAME hash', async () => {
    const student = await createUser();
    const verificationHash = recomputeVerificationHash({
      certificateId: 'cert-1',
      studentNameSnapshot: 'Jane Doe',
      courseTitleSnapshot: 'Security 101',
      issuedAt: new Date(),
    });

    const { signature, signingKeyVersion, encryptedContent } = signAndEncryptCertificate({
      studentId: student._id,
      verificationHash,
      certificateData: { certificate_id: 'cert-1' },
    });

    expect(signature).toEqual(expect.any(String));
    expect(signingKeyVersion).toBe('test-v1');
    expect(encryptedContent).toBeInstanceOf(Buffer);

    const isValid = verifyCertificateSignature({ verificationHash, signatureBase64: signature });
    expect(isValid).toBe(true);
  });

  it('verifyCertificateSignature returns false (never throws) for a DIFFERENT hash than what was signed', async () => {
    const student = await createUser();
    const originalHash = recomputeVerificationHash({
      certificateId: 'cert-1',
      studentNameSnapshot: 'Jane Doe',
      courseTitleSnapshot: 'Security 101',
      issuedAt: new Date(),
    });
    const tamperedHash = recomputeVerificationHash({
      certificateId: 'cert-1-TAMPERED',
      studentNameSnapshot: 'Jane Doe',
      courseTitleSnapshot: 'Security 101',
      issuedAt: new Date(),
    });

    const { signature } = signAndEncryptCertificate({
      studentId: student._id,
      verificationHash: originalHash,
      certificateData: { certificate_id: 'cert-1' },
    });

    const isValid = verifyCertificateSignature({
      verificationHash: tamperedHash,
      signatureBase64: signature,
    });
    expect(isValid).toBe(false);
  });

  it('verifyCertificateSignature returns false (never throws) for malformed/garbage base64', () => {
    const isValid = verifyCertificateSignature({
      verificationHash: 'somehash',
      signatureBase64: 'not-valid-base64-signature!!!',
    });
    expect(isValid).toBe(false);
  });

  it('encrypted certificates for TWO DIFFERENT students use different derived keys (per-user isolation)', async () => {
    const studentA = await createUser();
    const studentB = await createUser();
    const verificationHash = recomputeVerificationHash({
      certificateId: 'cert-shared-payload',
      studentNameSnapshot: 'Same Name',
      courseTitleSnapshot: 'Same Course',
      issuedAt: new Date('2026-01-01'),
    });
    const certificateData = { certificate_id: 'cert-shared-payload' };

    const resultA = signAndEncryptCertificate({
      studentId: studentA._id,
      verificationHash,
      certificateData,
    });
    const resultB = signAndEncryptCertificate({
      studentId: studentB._id,
      verificationHash,
      certificateData,
    });

    // Identical plaintext + identical GCM IV chance is astronomically low,
    // but the derived KEY itself differs per user regardless — ciphertext
    // must differ even if (extremely unlikely) IVs collided.
    expect(resultA.encryptedContent.equals(resultB.encryptedContent)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Certificate.model.js — referential integrity guard
// ---------------------------------------------------------------------------
describe('Certificate model — applyReferentialIntegrity', () => {
  it('rejects creation when student_id does not reference an existing User', async () => {
    const fakeCourseId = new mongoose.Types.ObjectId();
    const fakeStudentId = new mongoose.Types.ObjectId();

    await expect(
      Certificate.create({
        student_id: fakeStudentId,
        course_id: fakeCourseId,
        student_name_snapshot: 'Ghost',
        course_title_snapshot: 'Ghost Course',
        qr_code_image: Buffer.alloc(1),
        verification_hash: 'a'.repeat(64),
        signature: 'sig',
        signing_key_version: 'v1',
        encrypted_content: Buffer.alloc(1),
      })
    ).rejects.toThrow(/REFERENTIAL_INTEGRITY/);
  });
});

// ---------------------------------------------------------------------------
// UC-CERT-06 — Manage Certificate Templates
// ---------------------------------------------------------------------------
describe('UC-CERT-06 — Certificate Templates CRUD', () => {
  it('createTemplate creates a template and logs the action', async () => {
    const admin = await createUser({ role: 'SuperAdmin' });

    const result = await createTemplate({
      adminId: admin._id,
      templateData: { name: 'Classic', layout_key: 'classic-v1' },
      req: fakeReq,
    });

    expect(result.data.template.name).toBe('Classic');
    const auditEntry = await AuditLog.findOne({ action: 'CERT_TEMPLATE_CREATED' });
    expect(auditEntry).not.toBeNull();
  });

  it('listTemplates returns all templates', async () => {
    await CertificateTemplate.create({ name: 'A', layout_key: 'a' });
    await CertificateTemplate.create({ name: 'B', layout_key: 'b' });

    const result = await listTemplates();
    expect(result.data.templates).toHaveLength(2);
  });

  it('updateTemplate modifies an existing template', async () => {
    const admin = await createUser({ role: 'SuperAdmin' });
    const template = await CertificateTemplate.create({ name: 'Old', layout_key: 'old' });

    const result = await updateTemplate({
      adminId: admin._id,
      templateId: template._id,
      updateData: { name: 'New' },
      req: fakeReq,
    });

    expect(result.data.template.name).toBe('New');
  });

  it('updateTemplate on a non-existent template → TEMPLATE_NOT_FOUND', async () => {
    const admin = await createUser({ role: 'SuperAdmin' });
    const fakeId = new mongoose.Types.ObjectId();

    await expect(
      updateTemplate({ adminId: admin._id, templateId: fakeId, updateData: {}, req: fakeReq })
    ).rejects.toMatchObject({ code: 'TEMPLATE_NOT_FOUND' });
  });

  it('deleteTemplate removes a template and logs the action', async () => {
    const admin = await createUser({ role: 'SuperAdmin' });
    const template = await CertificateTemplate.create({ name: 'ToDelete', layout_key: 'x' });

    const result = await deleteTemplate({
      adminId: admin._id,
      templateId: template._id,
      req: fakeReq,
    });

    expect(result.data.deleted).toBe(true);
    const stillExists = await CertificateTemplate.findById(template._id);
    expect(stillExists).toBeNull();

    const auditEntry = await AuditLog.findOne({ action: 'CERT_TEMPLATE_DELETED' });
    expect(auditEntry).not.toBeNull();
  });
});
