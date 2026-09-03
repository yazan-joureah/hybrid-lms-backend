// tests/integration/kycRoutes.test.js
//
// First real end-to-end HTTP test for KYC: multipart file upload via
// supertest, requireRole enforcement, and the full submit→review→approve
// flow through the actual Express app (not service-level bypass).

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const User = require('../../src/models/User');
const KYCRequest = require('../../src/models/KYCRequest');
const KYCDocument = require('../../src/models/KYCDocument');
const GuardianApproval = require('../../src/models/GuardianApproval');
const AuditLog = require('../../src/models/AuditLog');
const redisClient = require('../../src/config/redis');
const { signAccessToken } = require('../../src/utils/jwt');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function fakePng(extra = 100) {
  return Buffer.concat([PNG_SIGNATURE, Buffer.alloc(extra, 0x00)]);
}

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

function tokenFor(user) {
  return signAccessToken({ userId: user._id, sessionId: 'fake-session-id-for-tests' });
}

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI);
  }
}, 20000);

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    KYCRequest.deleteMany({}),
    KYCDocument.deleteMany({}),
    GuardianApproval.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);
  await redisClient.flushdb(); // isolate rate-limiter counters between tests
});

afterAll(async () => {
  await mongoose.connection.close();
  await redisClient.quit();
});

describe('POST /api/v1/kyc/requests — submission', () => {
  it('Student مؤهَّل يرفع الملفين بنجاح عبر multipart/form-data → 201', async () => {
    const student = await createUser();

    const res = await request(app)
      .post('/api/v1/kyc/requests')
      .set('Authorization', `Bearer ${tokenFor(student)}`)
      .field('idDocumentType', 'national_id')
      .attach('id_document', fakePng(), 'id_card.png')
      .attach('selfie', fakePng(50), 'selfie.png');

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const kycRequest = await KYCRequest.findOne({ user_id: student._id });
    expect(kycRequest).not.toBeNull();
    expect(kycRequest.status).toBe('review_pending');
  });

  it('بلا Authorization header → 401', async () => {
    const res = await request(app)
      .post('/api/v1/kyc/requests')
      .field('idDocumentType', 'national_id')
      .attach('id_document', fakePng(), 'id_card.png')
      .attach('selfie', fakePng(50), 'selfie.png');

    expect(res.status).toBe(401);
  });

  it('ملف selfie مفقود → 400 MISSING_FILES', async () => {
    const student = await createUser();

    const res = await request(app)
      .post('/api/v1/kyc/requests')
      .set('Authorization', `Bearer ${tokenFor(student)}`)
      .field('idDocumentType', 'national_id')
      .attach('id_document', fakePng(), 'id_card.png');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_FILES');
  });

  it('idDocumentType غير صالح (خارج enum) → 400 VALIDATION_ERROR من Zod', async () => {
    const student = await createUser();

    const res = await request(app)
      .post('/api/v1/kyc/requests')
      .set('Authorization', `Bearer ${tokenFor(student)}`)
      .field('idDocumentType', 'drivers_license') // ليست ضمن ['national_id', 'passport']
      .attach('id_document', fakePng(), 'id_card.png')
      .attach('selfie', fakePng(50), 'selfie.png');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('حجم ملف يتجاوز الحد الأقصى → 400 عبر MulterError المُطبَّع (وليس 500)', async () => {
    const student = await createUser();
    const oversized = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(6 * 1024 * 1024, 0x00)]); // >5MB

    const res = await request(app)
      .post('/api/v1/kyc/requests')
      .set('Authorization', `Bearer ${tokenFor(student)}`)
      .field('idDocumentType', 'national_id')
      .attach('id_document', oversized, 'id_card.png')
      .attach('selfie', fakePng(50), 'selfie.png');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('LIMIT_FILE_SIZE'); // MulterError.code الفعلي
  });
});

describe('requireRole enforcement على مسارات المراجعة', () => {
  it('Student يحاول الوصول لقائمة الطلبات المعلَّقة → 403 FORBIDDEN', async () => {
    const student = await createUser();

    const res = await request(app)
      .get('/api/v1/admin/kyc/requests')
      .set('Authorization', `Bearer ${tokenFor(student)}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('Admin يصل لقائمة الطلبات المعلَّقة بنجاح → 200', async () => {
    const admin = await createUser({
      role: 'Admin',
      kyc_status: 'not_submitted',
      mfa_enabled: true,
    });
    const otherStudent = await createUser();
    await KYCRequest.create({
      user_id: otherStudent._id,
      applicant_role: 'Student',
      id_document_reference: 'ref-1',
      selfie_reference: 'ref-2',
      status: 'review_pending',
    });

    const res = await request(app)
      .get('/api/v1/admin/kyc/requests')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.requests).toHaveLength(1);
  });
});

describe('المسار الكامل: تقديم → مراجعة → قبول عبر HTTP بالكامل', () => {
  it('Student يُقدِّم، Admin يوافق، الحالتان تُحدَّثان معاً', async () => {
    const student = await createUser({ birth_date: new Date('2000-01-01') });
    const admin = await createUser({ role: 'Admin', mfa_enabled: true });

    const submitRes = await request(app)
      .post('/api/v1/kyc/requests')
      .set('Authorization', `Bearer ${tokenFor(student)}`)
      .field('idDocumentType', 'national_id')
      .attach('id_document', fakePng(), 'id_card.png')
      .attach('selfie', fakePng(50), 'selfie.png');
    expect(submitRes.status).toBe(201);

    const kycRequest = await KYCRequest.findOne({ user_id: student._id });

    const approveRes = await request(app)
      .post(`/api/v1/admin/kyc/requests/${kycRequest._id}/approve`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ documentBirthDate: '2000-01-01' });

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.data.outcome).toBe('verified');

    const updatedStudent = await User.findById(student._id);
    expect(updatedStudent.kyc_status).toBe('verified');
  });

  it('Student (غير Admin) يحاول الموافقة على طلب → 403، الحالة تبقى review_pending', async () => {
    const student = await createUser();
    const otherStudent = await createUser();
    const kycRequest = await KYCRequest.create({
      user_id: otherStudent._id,
      applicant_role: 'Student',
      id_document_reference: 'ref-1',
      selfie_reference: 'ref-2',
      status: 'review_pending',
    });

    const res = await request(app)
      .post(`/api/v1/admin/kyc/requests/${kycRequest._id}/approve`)
      .set('Authorization', `Bearer ${tokenFor(student)}`) // ليس Admin
      .send({ documentBirthDate: '2000-01-01' });

    expect(res.status).toBe(403);

    const unchangedRequest = await KYCRequest.findById(kycRequest._id);
    expect(unchangedRequest.status).toBe('review_pending'); // لم يتغيّر — الثغرة المُصلَحة سابقاً لم تعد قابلة للاستغلال
  });

  it('فارق عمر أصفر بدون confirmYellowTier → 409 AGE_DISCREPANCY_REQUIRES_CONFIRMATION، ثم إعادة الإرسال مع التأكيد → 200 verified', async () => {
    const student = await createUser({ birth_date: new Date('2000-01-01') });
    const admin = await createUser({ role: 'Admin', mfa_enabled: true });

    const submitRes = await request(app)
      .post('/api/v1/kyc/requests')
      .set('Authorization', `Bearer ${tokenFor(student)}`)
      .field('idDocumentType', 'national_id')
      .attach('id_document', fakePng(), 'id_card.png')
      .attach('selfie', fakePng(50), 'selfie.png');
    expect(submitRes.status).toBe(201);

    const kycRequest = await KYCRequest.findOne({ user_id: student._id });

    // فارق أصفر: 2000-01-01 مقابل 2001-08-01 → سنة و7 أشهر (راجع ageDiscrepancy.test.js)
    const firstAttempt = await request(app)
      .post(`/api/v1/admin/kyc/requests/${kycRequest._id}/approve`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ documentBirthDate: '2001-08-01' });

    expect(firstAttempt.status).toBe(409);
    expect(firstAttempt.body.error.code).toBe('AGE_DISCREPANCY_REQUIRES_CONFIRMATION');
    expect(firstAttempt.body.error.tier).toBe('yellow'); // Updated: target error object

    const stillPending = await KYCRequest.findById(kycRequest._id);
    expect(stillPending.status).toBe('review_pending');

    const secondAttempt = await request(app)
      .post(`/api/v1/admin/kyc/requests/${kycRequest._id}/approve`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ documentBirthDate: '2001-08-01', confirmYellowTier: true });

    expect(secondAttempt.status).toBe(200);
    expect(secondAttempt.body.data.outcome).toBe('verified');

    const updatedStudent = await User.findById(student._id);
    expect(updatedStudent.kyc_status).toBe('verified');
  });
});

describe('POST /api/v1/kyc/age-correction — تصحيح العمر بعد age_flagged', () => {
  it('طالب age_flagged نشط يطلب تصحيحاً صالحاً → 200، birth_date يُحدَّث، status=guardian_pending، وGuardianApproval يُنشأ', async () => {
    const student = await createUser({
      status: 'active',
      kyc_status: 'age_flagged',
      birth_date: new Date('2010-01-01'),
    });

    const res = await request(app)
      .post('/api/v1/kyc/age-correction')
      .set('Authorization', `Bearer ${tokenFor(student)}`)
      .send({ birth_date: '2011-06-15', guardian_email: 'guardian@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const updatedStudent = await User.findById(student._id);
    expect(updatedStudent.status).toBe('guardian_pending');
    expect(updatedStudent.birth_date.toISOString().slice(0, 10)).toBe('2011-06-15');

    const approval = await GuardianApproval.findOne({ user_id: student._id });
    expect(approval).not.toBeNull();
    expect(approval.status).toBe('pending');
    expect(approval.guardian_email).toBe('guardian@example.com');

    const auditEntry = await AuditLog.findOne({ action: 'AGE_CORRECTION_GUARDIAN_REQUESTED' });
    expect(auditEntry).not.toBeNull();
  });

  it('بلا Authorization header → 401', async () => {
    const res = await request(app)
      .post('/api/v1/kyc/age-correction')
      .send({ birth_date: '2011-06-15', guardian_email: 'guardian@example.com' });

    expect(res.status).toBe(401);
  });

  it('بريد ولي الأمر مطابق لبريد الطالب نفسه → 400 GUARDIAN_EMAIL_SAME_AS_STUDENT', async () => {
    const student = await createUser({
      status: 'active',
      kyc_status: 'age_flagged',
      email: 'same-person@example.com',
    });

    const res = await request(app)
      .post('/api/v1/kyc/age-correction')
      .set('Authorization', `Bearer ${tokenFor(student)}`)
      .send({ birth_date: '2011-06-15', guardian_email: 'same-person@example.com' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('GUARDIAN_EMAIL_SAME_AS_STUDENT');
  });

  it('kyc_status ليس age_flagged → 409 NOT_AGE_FLAGGED', async () => {
    const student = await createUser({ status: 'active', kyc_status: 'verified' });

    const res = await request(app)
      .post('/api/v1/kyc/age-correction')
      .set('Authorization', `Bearer ${tokenFor(student)}`)
      .send({ birth_date: '2011-06-15', guardian_email: 'guardian@example.com' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_AGE_FLAGGED');
  });

  it('حساب غير active (مثلاً guardian_pending مسبقاً) → 403 ACCOUNT_NOT_ACTIVE', async () => {
    const student = await createUser({ status: 'guardian_pending', kyc_status: 'age_flagged' });

    const res = await request(app)
      .post('/api/v1/kyc/age-correction')
      .set('Authorization', `Bearer ${tokenFor(student)}`)
      .send({ birth_date: '2011-06-15', guardian_email: 'guardian@example.com' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_ACTIVE');
  });

  it('طلب تصحيح معلَّق مسبقاً لنفس الطالب → 409 CORRECTION_ALREADY_PENDING', async () => {
    const student = await createUser({ status: 'active', kyc_status: 'age_flagged' });
    await GuardianApproval.create({
      user_id: student._id,
      guardian_email: 'first-attempt@example.com',
      approval_token_hash: 'irrelevant-hash-1',
      student_access_token_hash: 'irrelevant-hash-2',
      status: 'pending',
      expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000),
      student_registration_ip: '127.0.0.1',
    });

    const res = await request(app)
      .post('/api/v1/kyc/age-correction')
      .set('Authorization', `Bearer ${tokenFor(student)}`)
      .send({ birth_date: '2011-06-15', guardian_email: 'second-attempt@example.com' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CORRECTION_ALREADY_PENDING');
  });

  it('مستخدم لم يعد موجوداً في قاعدة البيانات (توكن صالح لحساب محذوف) → 404 USER_NOT_FOUND', async () => {
    const fakeUserId = new mongoose.Types.ObjectId();
    const token = signAccessToken({ userId: fakeUserId, sessionId: 'fake-session-id-for-tests' });

    const res = await request(app)
      .post('/api/v1/kyc/age-correction')
      .set('Authorization', `Bearer ${token}`)
      .send({ birth_date: '2011-06-15', guardian_email: 'guardian@example.com' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('تنسيق birth_date غير صالح (ليس YYYY-MM-DD) → 400 VALIDATION_ERROR من Zod', async () => {
    const student = await createUser({ status: 'active', kyc_status: 'age_flagged' });

    const res = await request(app)
      .post('/api/v1/kyc/age-correction')
      .set('Authorization', `Bearer ${tokenFor(student)}`)
      .send({ birth_date: '15/06/2011', guardian_email: 'guardian@example.com' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('بريد إلكتروني غير صالح لولي الأمر → 400 VALIDATION_ERROR من Zod', async () => {
    const student = await createUser({ status: 'active', kyc_status: 'age_flagged' });

    const res = await request(app)
      .post('/api/v1/kyc/age-correction')
      .set('Authorization', `Bearer ${tokenFor(student)}`)
      .send({ birth_date: '2011-06-15', guardian_email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
