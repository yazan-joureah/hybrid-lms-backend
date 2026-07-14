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
      .get('/api/v1/kyc/requests')
      .set('Authorization', `Bearer ${tokenFor(student)}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('Admin يصل لقائمة الطلبات المعلَّقة بنجاح → 200', async () => {
    const admin = await createUser({ role: 'Admin', kyc_status: 'not_submitted' });
    const otherStudent = await createUser();
    await KYCRequest.create({
      user_id: otherStudent._id,
      applicant_role: 'Student',
      id_document_reference: 'ref-1',
      selfie_reference: 'ref-2',
      status: 'review_pending',
    });

    const res = await request(app)
      .get('/api/v1/kyc/requests')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.requests).toHaveLength(1);
  });
});

describe('المسار الكامل: تقديم → مراجعة → قبول عبر HTTP بالكامل', () => {
  it('Student يُقدِّم، Admin يوافق، الحالتان تُحدَّثان معاً', async () => {
    const student = await createUser({ birth_date: new Date('2000-01-01') });
    const admin = await createUser({ role: 'Admin' });

    const submitRes = await request(app)
      .post('/api/v1/kyc/requests')
      .set('Authorization', `Bearer ${tokenFor(student)}`)
      .field('idDocumentType', 'national_id')
      .attach('id_document', fakePng(), 'id_card.png')
      .attach('selfie', fakePng(50), 'selfie.png');
    expect(submitRes.status).toBe(201);

    const kycRequest = await KYCRequest.findOne({ user_id: student._id });

    const approveRes = await request(app)
      .post(`/api/v1/kyc/requests/${kycRequest._id}/approve`)
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
      .post(`/api/v1/kyc/requests/${kycRequest._id}/approve`)
      .set('Authorization', `Bearer ${tokenFor(student)}`) // ليس Admin
      .send({ documentBirthDate: '2000-01-01' });

    expect(res.status).toBe(403);

    const unchangedRequest = await KYCRequest.findById(kycRequest._id);
    expect(unchangedRequest.status).toBe('review_pending'); // لم يتغيّر — الثغرة المُصلَحة سابقاً لم تعد قابلة للاستغلال
  });
});
