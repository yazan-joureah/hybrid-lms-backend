// tests/integration/kycSubmission.test.js
//
// Service-level integration test لـ UC-KYC-01 (submitKycRequest) ضد
// MongoDB حقيقي. لا حاجة لـ clamd بعد قرار حذف فحص Antivirus — فقط
// fileValidation.util.js (Magic Bytes حقيقية) يعمل ضمن السلسلة.

const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../../src/models/User');
const KYCRequest = require('../../src/models/KYCRequest');
const KYCDocument = require('../../src/models/KYCDocument');
const AuditLog = require('../../src/models/AuditLog');
const {
  submitKycRequest,
  checkSubmissionEligibility,
} = require('../../src/services/kyc/kycSubmission.service');

// نفس توقيعات Magic Bytes الحقيقية المستخدَمة في fileValidation.test.js
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TEXT_NO_SIGNATURE = Buffer.from('not an image at all');

function buildFakePngFile(extraBytes = 100) {
  return Buffer.concat([PNG_SIGNATURE, Buffer.alloc(extraBytes, 0x00)]);
}

const fakeReq = { ip: '127.0.0.1', get: () => 'jest-test-agent' };

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

function validSubmissionParams(userId) {
  return {
    userId: String(userId),
    idDocumentType: 'national_id',
    idDocumentFile: { buffer: buildFakePngFile(), filename: 'id_card.png' },
    selfieFile: { buffer: buildFakePngFile(50), filename: 'selfie.png' },
    req: fakeReq,
  };
}

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    // 2. Fallback URI and Safety routing to a "_test" database
    const baseUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/hybrid_lms';

    // IMPORTANT: Ensure we connect to a separate test DB so deleteMany() doesn't wipe your dev data
    const testUri = baseUri.endsWith('_test') ? baseUri : `${baseUri}_test`;

    await mongoose.connect(testUri);
  }
}, 20000);

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    KYCRequest.deleteMany({}),
    KYCDocument.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.connection.close();
});

describe('checkSubmissionEligibility — فحوصات مباشرة بلا قاعدة بيانات', () => {
  it('حساب غير active → ACCOUNT_NOT_ACTIVE', () => {
    const result = checkSubmissionEligibility({
      status: 'temporary_locked',
      role: 'Student',
      kyc_status: 'not_submitted',
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('ACCOUNT_NOT_ACTIVE');
  });

  it('دور Admin → ROLE_NOT_ELIGIBLE', () => {
    const result = checkSubmissionEligibility({
      status: 'active',
      role: 'Admin',
      kyc_status: 'not_submitted',
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('ROLE_NOT_ELIGIBLE');
  });

  it('Instructor بلا mfa_enabled → MFA_NOT_ENABLED (الفحص الأخف المُثبَّت)', () => {
    const result = checkSubmissionEligibility({
      status: 'active',
      role: 'Instructor',
      kyc_status: 'not_submitted',
      mfa_enabled: false,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('MFA_NOT_ENABLED');
  });

  it('Instructor بـ mfa_enabled=true → مؤهَّل', () => {
    const result = checkSubmissionEligibility({
      status: 'active',
      role: 'Instructor',
      kyc_status: 'not_submitted',
      mfa_enabled: true,
    });
    expect(result.eligible).toBe(true);
  });

  it('kyc_status=review_pending → REQUEST_ALREADY_PENDING', () => {
    const result = checkSubmissionEligibility({
      status: 'active',
      role: 'Student',
      kyc_status: 'review_pending',
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('REQUEST_ALREADY_PENDING');
  });

  it('kyc_status=age_flagged → REQUEST_ALREADY_PENDING (القرار المُثبَّت: نفس معاملة review_pending)', () => {
    const result = checkSubmissionEligibility({
      status: 'active',
      role: 'Student',
      kyc_status: 'age_flagged',
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('REQUEST_ALREADY_PENDING');
  });

  it('kyc_status=verified → ALREADY_VERIFIED', () => {
    const result = checkSubmissionEligibility({
      status: 'active',
      role: 'Student',
      kyc_status: 'verified',
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('ALREADY_VERIFIED');
  });

  it('kyc_status=rejected → مؤهَّل لإعادة التقديم', () => {
    const result = checkSubmissionEligibility({
      status: 'active',
      role: 'Student',
      kyc_status: 'rejected',
    });
    expect(result.eligible).toBe(true);
  });
});

describe('submitKycRequest — المسار الناجح الكامل', () => {
  it('Student مؤهَّل → ينشئ KYCDocument مرتين + KYCRequest + يُحدِّث User.kyc_status', async () => {
    const student = await createUser();

    const result = await submitKycRequest(validSubmissionParams(student._id));

    expect(result.success).toBe(true);

    const documents = await KYCDocument.find({ user_id: student._id });
    expect(documents).toHaveLength(2);
    expect(documents.map((d) => d.document_type).sort()).toEqual(['national_id', 'selfie']);

    const kycRequest = await KYCRequest.findOne({ user_id: student._id });
    expect(kycRequest).not.toBeNull();
    expect(kycRequest.status).toBe('review_pending');
    expect(kycRequest.applicant_role).toBe('Student');
    expect(kycRequest.id_document_reference).toBe(
      documents.find((d) => d.document_type === 'national_id').file_reference
    );
    expect(kycRequest.selfie_reference).toBe(
      documents.find((d) => d.document_type === 'selfie').file_reference
    );

    const updatedStudent = await User.findById(student._id);
    expect(updatedStudent.kyc_status).toBe('review_pending');

    const auditEntry = await AuditLog.findOne({ action: 'KYC_REQUEST_SUBMITTED' });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry.actor_id.toString()).toBe(String(student._id));
  });

  it('Instructor مؤهَّل (mfa_enabled=true) → ينجح، applicant_role=Instructor', async () => {
    const instructor = await createUser({ role: 'Instructor', mfa_enabled: true });

    const result = await submitKycRequest(validSubmissionParams(instructor._id));

    expect(result.success).toBe(true);
    const kycRequest = await KYCRequest.findOne({ user_id: instructor._id });
    expect(kycRequest.applicant_role).toBe('Instructor');
  });
});

describe('submitKycRequest — رفض الأهلية قبل أي معالجة ملفات', () => {
  it('Instructor بلا MFA → يرفض دون إنشاء أي KYCDocument', async () => {
    const instructor = await createUser({ role: 'Instructor', mfa_enabled: false });

    const result = await submitKycRequest(validSubmissionParams(instructor._id));

    expect(result.success).toBe(false);
    expect(result.reason).toBe('MFA_NOT_ENABLED');

    const documents = await KYCDocument.find({ user_id: instructor._id });
    expect(documents).toHaveLength(0); // تأكيد Fail Fast: لا معالجة ملفات حدثت إطلاقاً
  });

  it('طلب قائم بالفعل (review_pending) → يرفض التقديم الثاني', async () => {
    const student = await createUser({ kyc_status: 'review_pending' });

    const result = await submitKycRequest(validSubmissionParams(student._id));

    expect(result.success).toBe(false);
    expect(result.reason).toBe('REQUEST_ALREADY_PENDING');
  });
});

describe('submitKycRequest — Compensating Rollback عند فشل الملف الثاني', () => {
  it('وثيقة الهوية تنجح لكن الـ Selfie تفشل (تنسيق غير صالح) → يُحذَف مستند الهوية اليتيم', async () => {
    const student = await createUser();

    const params = validSubmissionParams(student._id);
    params.selfieFile = { buffer: TEXT_NO_SIGNATURE, filename: 'selfie.png' };

    const result = await submitKycRequest(params);

    expect(result.success).toBe(false);
    // ملاحظة: 'INVALID_FILE' وليس 'FILE_TYPE_UNRECOGNIZED' — السبب الدقيق
    // يُعمَّم عمداً في kycDocumentStorage.service.js (منع تسريب تفاصيل
    // الفحص الداخلي للمستخدم، OWASP A10). السبب الدقيق لا يزال متاحاً في
    // Audit Log (action: KYC_DOCUMENT_REJECTED_FORMAT، metadata.reason).
    expect(result.reason).toBe('INVALID_FILE');

    const documents = await KYCDocument.find({ user_id: student._id });
    expect(documents).toHaveLength(0);

    const kycRequest = await KYCRequest.findOne({ user_id: student._id });
    expect(kycRequest).toBeNull();

    const unchangedStudent = await User.findById(student._id);
    expect(unchangedStudent.kyc_status).toBe('not_submitted');
  });
});
