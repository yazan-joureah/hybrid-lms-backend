const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const User = require('../../src/models/User');
const GuardianApproval = require('../../src/models/GuardianApproval');
const AuditLog = require('../../src/models/AuditLog');
const { generateOpaqueToken } = require('../../src/utils/crypto');
const redisClient = require('../../src/config/redis');

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI);
  }
}, 20000);

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    GuardianApproval.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);
  await redisClient.flushdb();
});

afterAll(async () => {
  await mongoose.connection.close();
  await redisClient.quit();
});

async function createMinorWithPendingApproval({ emailVerified = false, expiresInHours = 48 } = {}) {
  const user = await User.create({
    full_name: 'Test Minor User',
    email: 'minor.approve@example.com',
    password_hash: 'irrelevant',
    birth_date: new Date('2012-01-01'),
    role: 'Student',
    status: 'guardian_pending',
    email_verified_at: emailVerified ? new Date() : null,
    privacy_consent: {
      policy_version: 'v1.0',
      accepted_at: new Date(),
      ip: '10.0.0.1',
      user_agent: 'jest',
    },
  });

  const { raw, hash } = generateOpaqueToken();
  const approval = await GuardianApproval.create({
    user_id: user._id,
    guardian_email: 'guardian.approve@example.com',
    approval_token_hash: hash,
    student_access_token_hash: 'irrelevant-hash',
    status: 'pending',
    expires_at: new Date(Date.now() + expiresInHours * 60 * 60 * 1000),
    student_registration_ip: '10.0.0.1',
    student_device_fingerprint: 'student-device-abc',
  });

  return { user, approval, rawToken: raw };
}

const VALID_BODY = {
  decision: 'approve',
  guardian_full_name: 'Mona Khalil',
  relationship: 'parent',
  consent: true,
};

describe('GET /auth/guardian/approve — placeholder', () => {
  it('returns 200 and echoes whether a token was received', async () => {
    const res = await request(app)
      .get('/api/v1/auth/guardian/approve')
      .query({ token: 'anything' });
    expect(res.status).toBe(200);
    expect(res.body.data.token_received).toBe(true);
  });
});

describe('POST /auth/guardian/approve — approve, email already verified', () => {
  it('activates the account immediately', async () => {
    const { user, rawToken } = await createMinorWithPendingApproval({ emailVerified: true });

    const res = await request(app)
      .post('/api/v1/auth/guardian/approve')
      .send({ ...VALID_BODY, token: rawToken });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('active');

    const updated = await User.findById(user._id);
    expect(updated.status).toBe('active');
  });
});

describe('POST /auth/guardian/approve — approve, email NOT yet verified', () => {
  it('records the approval but keeps status=guardian_pending', async () => {
    const { user, rawToken } = await createMinorWithPendingApproval({ emailVerified: false });

    const res = await request(app)
      .post('/api/v1/auth/guardian/approve')
      .send({ ...VALID_BODY, token: rawToken });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('guardian_pending');

    const approval = await GuardianApproval.findOne({ user_id: user._id });
    expect(approval.status).toBe('approved');
    expect(approval.approved_at).not.toBeNull();
  });
});

describe('POST /auth/guardian/approve — decline', () => {
  it('sets status=rejected, does NOT delete the account, and does not activate it', async () => {
    const { user, rawToken } = await createMinorWithPendingApproval({ emailVerified: true });

    const res = await request(app).post('/api/v1/auth/guardian/approve').send({
      token: rawToken,
      decision: 'decline',
      guardian_full_name: 'Mona Khalil',
      relationship: 'parent',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('guardian_pending');

    const updatedUser = await User.findById(user._id);
    expect(updatedUser.status).toBe('guardian_pending'); // never deleted, never activated

    const approval = await GuardianApproval.findOne({ user_id: user._id });
    expect(approval.status).toBe('rejected');
    expect(approval.rejected_at).not.toBeNull();
  });
});

describe('POST /auth/guardian/approve — replay protection', () => {
  it('rejects a second use of the same token with TOKEN_ALREADY_USED', async () => {
    const { rawToken } = await createMinorWithPendingApproval({ emailVerified: true });

    const first = await request(app)
      .post('/api/v1/auth/guardian/approve')
      .send({ ...VALID_BODY, token: rawToken });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/v1/auth/guardian/approve')
      .send({ ...VALID_BODY, token: rawToken });
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('TOKEN_ALREADY_USED');
  });
});

describe('POST /auth/guardian/approve — expired token', () => {
  it('returns 400 TOKEN_EXPIRED', async () => {
    const { rawToken } = await createMinorWithPendingApproval({ expiresInHours: -1 });

    const res = await request(app)
      .post('/api/v1/auth/guardian/approve')
      .send({ ...VALID_BODY, token: rawToken });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });
});

describe('POST /auth/guardian/approve — approve without consent=true', () => {
  it('rejects with 400 VALIDATION_ERROR (Zod refine), never reaching the service', async () => {
    const { rawToken } = await createMinorWithPendingApproval({ emailVerified: true });

    const res = await request(app).post('/api/v1/auth/guardian/approve').send({
      token: rawToken,
      decision: 'approve',
      guardian_full_name: 'Mona Khalil',
      relationship: 'parent',
    });

    expect(res.status).toBe(400);
  });
});

describe('POST /auth/guardian/approve — MUC-AUTH-09 collision detection', () => {
  it('still approves but logs a GUARDIAN_APPROVED_FLAGGED_FOR_REVIEW audit event when device fingerprint matches the student', async () => {
    const { user, rawToken } = await createMinorWithPendingApproval({ emailVerified: true });

    const res = await request(app)
      .post('/api/v1/auth/guardian/approve')
      .set('x-device-fingerprint', 'student-device-abc') // matches student's own fingerprint
      .send({ ...VALID_BODY, token: rawToken });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('active'); // NOT blocked — flagged only

    const flagged = await AuditLog.findOne({
      action: 'GUARDIAN_APPROVED_FLAGGED_FOR_REVIEW',
      resource_id: String(await GuardianApproval.findOne({ user_id: user._id }).then((a) => a._id)),
    });
    expect(flagged).not.toBeNull();
  });
});
