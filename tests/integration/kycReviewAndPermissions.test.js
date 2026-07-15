// tests/integration/kycReviewAndPermissions.test.js
//
// Service-level integration test (بنفس نمط اختبار UC-AUTH-04 لتجاوز HTTP
// قبل بناء kycController.js) — يختبر kycReview.service.js وkycPermissions
// .service.js ضد MongoDB حقيقي. لا يحتاج clamd (لا استدعاء لـ
// malwareScan في مسار المراجعة إطلاقاً — الفحص يحدث فقط وقت التقديم).

const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../../src/models/User');
const KYCRequest = require('../../src/models/KYCRequest');
const AuditLog = require('../../src/models/AuditLog');
const {
  approveKycRequest,
  rejectKycRequest,
  getRequestForReview,
} = require('../../src/services/kyc/kycReview.service');

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
  await Promise.all([User.deleteMany({}), KYCRequest.deleteMany({}), AuditLog.deleteMany({})]);
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
    kyc_status: 'review_pending',
    mfa_enabled: false,
    ...overrides,
  });
}

async function createAdmin() {
  return createUser({ role: 'Admin', kyc_status: 'not_submitted' });
}

async function createKycRequest(userId, applicantRole = 'Student') {
  return KYCRequest.create({
    user_id: userId,
    applicant_role: applicantRole,
    id_document_reference: 'fake-id-doc-ref-' + Math.random(),
    selfie_reference: 'fake-selfie-ref-' + Math.random(),
    status: 'review_pending',
  });
}

describe('getRequestForReview', () => {
  it('يُعيد الطلب وبيانات مقدّمه معاً عندما يكون review_pending', async () => {
    const student = await createUser();
    const kycRequest = await createKycRequest(student._id);

    const result = await getRequestForReview(String(kycRequest._id));

    expect(result).not.toBeNull();
    expect(String(result.applicant._id)).toBe(String(student._id));
  });

  it('يُعيد null إذا كانت الحالة verified مسبقاً (لا يُعاد فتح طلب مُغلَق)', async () => {
    const student = await createUser();
    const kycRequest = await createKycRequest(student._id);
    kycRequest.status = 'verified';
    await kycRequest.save();

    const result = await getRequestForReview(String(kycRequest._id));
    expect(result).toBeNull();
  });
});

describe('approveKycRequest — مسار Student (بلا SF-KYC-01)', () => {
  it('يُحدِّث الحالة إلى verified على كل من KYCRequest وUser، بلا استدعاء لصلاحيات المدرّس', async () => {
    const admin = await createAdmin();
    const student = await createUser({ birth_date: new Date('2000-01-01') });
    const kycRequest = await createKycRequest(student._id, 'Student');

    const result = await approveKycRequest({
      kycRequestId: String(kycRequest._id),
      adminUserId: String(admin._id),
      documentBirthDate: new Date('2000-01-01'), // فارق 0 — أخضر
      req: { ip: '127.0.0.1', get: () => 'jest-test-agent' },
    });

    expect(result.success).toBe(true);
    expect(result.outcome).toBe('verified');

    const updatedRequest = await KYCRequest.findById(kycRequest._id);
    expect(updatedRequest.status).toBe('verified');
    expect(updatedRequest.reviewed_by_admin_id.toString()).toBe(String(admin._id));

    const updatedStudent = await User.findById(student._id);
    expect(updatedStudent.kyc_status).toBe('verified');

    // لا سجل KYC_INSTRUCTOR_PERMISSIONS_GRANTED لأن applicant_role=Student
    const permissionLog = await AuditLog.findOne({ action: 'KYC_INSTRUCTOR_PERMISSIONS_GRANTED' });
    expect(permissionLog).toBeNull();
  });
});

describe('approveKycRequest — مسار Instructor (يُطلق SF-KYC-01)', () => {
  it('يُسجِّل KYC_INSTRUCTOR_PERMISSIONS_GRANTED في Audit Log عند قبول طلب مدرّس', async () => {
    const admin = await createAdmin();
    const instructor = await createUser({ role: 'Instructor', birth_date: new Date('1990-05-15') });
    const kycRequest = await createKycRequest(instructor._id, 'Instructor');

    await approveKycRequest({
      kycRequestId: String(kycRequest._id),
      adminUserId: String(admin._id),
      documentBirthDate: new Date('1990-05-15'),
      req: { ip: '127.0.0.1', get: () => 'jest-test-agent' },
    });

    const permissionLog = await AuditLog.findOne({
      action: 'KYC_INSTRUCTOR_PERMISSIONS_GRANTED',
      resource_id: String(instructor._id),
    });
    expect(permissionLog).not.toBeNull();
    expect(permissionLog.actor_id.toString()).toBe(String(admin._id));
  });

  it('يستخدم applicant_role المُجمَّد وقت التقديم، وليس User.role الحالي', async () => {
    // حالة حدّية: مستخدم قدَّم الطلب كـ Instructor، لكن دوره تغيّر لاحقاً
    // (سيناريو نظري نادر لكنه يختبر القرار التصميمي المُثبَّت في KYCRequest.js)
    const admin = await createAdmin();
    const user = await createUser({ role: 'Student', birth_date: new Date('1990-01-01') }); // الدور الحالي تغيّر إلى Student
    const kycRequest = await createKycRequest(user._id, 'Instructor'); // لكن applicant_role المُجمَّد كان Instructor

    await approveKycRequest({
      kycRequestId: String(kycRequest._id),
      adminUserId: String(admin._id),
      documentBirthDate: new Date('1990-01-01'),
      req: { ip: '127.0.0.1', get: () => 'jest-test-agent' },
    });

    const permissionLog = await AuditLog.findOne({ action: 'KYC_INSTRUCTOR_PERMISSIONS_GRANTED' });
    expect(permissionLog).not.toBeNull(); // اعتمد على applicant_role المُجمَّد، وليس الدور الحالي
  });
});

describe('approveKycRequest — EXT-KYC-01 (فارق العمر الأحمر يتجاوز نية القبول)', () => {
  it('فارق > 2 سنة → outcome=age_flagged رغم استدعاء approveKycRequest، وkyc_status=age_flagged', async () => {
    const admin = await createAdmin();
    const student = await createUser({ birth_date: new Date('2000-01-01') });
    const kycRequest = await createKycRequest(student._id, 'Student');

    const result = await approveKycRequest({
      kycRequestId: String(kycRequest._id),
      adminUserId: String(admin._id),
      documentBirthDate: new Date('2005-01-01'), // فارق 5 سنوات — أحمر
      req: { ip: '127.0.0.1', get: () => 'jest-test-agent' },
    });

    expect(result.success).toBe(true);
    expect(result.outcome).toBe('age_flagged'); // ليس verified رغم أن الدالة اسمها approve

    const updatedStudent = await User.findById(student._id);
    expect(updatedStudent.kyc_status).toBe('age_flagged');

    const updatedRequest = await KYCRequest.findById(kycRequest._id);
    expect(updatedRequest.status).toBe('age_flagged');
    expect(updatedRequest.age_discrepancy_years).toBeGreaterThan(2);

    // لا صلاحيات مدرّس تُمنَح أبداً في حالة age_flagged، حتى لو كان
    // applicant_role=Instructor (تحقق سلبي إضافي)
    const permissionLog = await AuditLog.findOne({ action: 'KYC_INSTRUCTOR_PERMISSIONS_GRANTED' });
    expect(permissionLog).toBeNull();
  });
});

describe('rejectKycRequest', () => {
  it('يرفض بسبب صالح من REJECTION_REASONS ويُحدِّث الحالتين معاً', async () => {
    const admin = await createAdmin();
    const student = await createUser();
    const kycRequest = await createKycRequest(student._id);

    const result = await rejectKycRequest({
      kycRequestId: String(kycRequest._id),
      adminUserId: String(admin._id),
      rejectionReason: 'UNCLEAR_IMAGE',
      req: { ip: '127.0.0.1', get: () => 'jest-test-agent' },
    });

    expect(result.success).toBe(true);

    const updatedRequest = await KYCRequest.findById(kycRequest._id);
    expect(updatedRequest.status).toBe('rejected');
    expect(updatedRequest.review_decision_reason).toBe('UNCLEAR_IMAGE');

    const updatedStudent = await User.findById(student._id);
    expect(updatedStudent.kyc_status).toBe('rejected');
  });

  it('يرفض سبباً غير موجود في REJECTION_REASONS دون لمس أي بيانات', async () => {
    const admin = await createAdmin();
    const student = await createUser();
    const kycRequest = await createKycRequest(student._id);

    const result = await rejectKycRequest({
      kycRequestId: String(kycRequest._id),
      adminUserId: String(admin._id),
      rejectionReason: 'MADE_UP_REASON', // ليست في القائمة المصنَّفة
      req: { ip: '127.0.0.1', get: () => 'jest-test-agent' },
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe('INVALID_REJECTION_REASON');

    // تأكيد سلبي: الطلب لم يتغيّر إطلاقاً
    const unchangedRequest = await KYCRequest.findById(kycRequest._id);
    expect(unchangedRequest.status).toBe('review_pending');
  });
});
