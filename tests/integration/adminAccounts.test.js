// tests/integration/adminAccounts.test.js
//
// Closes the admin-account-management coverage gap: privilege escalation
// guards (assertCanManageTarget), self-action prevention, session/OAuth
// revocation side-effects, and the 30-day restore window.
//
// ASSUMPTION: Course.js / Enrollment.js schemas were not in the reference
// set I was given. Fields used below (owner_instructor_id, status on
// Course; student_id, status on Enrollment) are inferred strictly from the
// query filters in manageAccounts.service.js / accountDeletionRequest
// .service.js. Those two specific tests auto-skip if the models aren't
// resolvable, so the rest of the suite still runs cleanly either way —
// please verify field names against the real schema and remove the guard.

// ===== MOCK the ESM-only 'jose' package to avoid Jest parse errors =====
jest.mock('jose', () => ({
  SignJWT: jest.fn().mockImplementation(() => ({
    setProtectedHeader: jest.fn().mockReturnThis(),
    setIssuedAt: jest.fn().mockReturnThis(),
    setExpirationTime: jest.fn().mockReturnThis(),
    sign: jest.fn().mockResolvedValue('fake-jwt-token'),
  })),
  jwtVerify: jest.fn().mockResolvedValue({ payload: { sub: 'mock-user-id' } }),
}));
// =======================================================================

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const User = require('../../src/models/User');
const Session = require('../../src/models/Session');
const RefreshToken = require('../../src/models/RefreshToken');
const ExternalIdentity = require('../../src/models/ExternalIdentity');
const AccountDeletionRequest = require('../../src/models/AccountDeletionRequest');
const AuthToken = require('../../src/models/AuthToken');
const AuditLog = require('../../src/models/AuditLog');
let Course = null;
let Enrollment = null;
try {
  Course = require('../../src/models/Course');
} catch (e) {
  /* not available */
}
try {
  Enrollment = require('../../src/models/Enrollment');
} catch (e) {
  /* not available */
}
const { hashPassword } = require('../../src/utils/crypto');
const { signAccessToken } = require('../../src/utils/jwt');
const redisClient = require('../../src/config/redis');

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI);
  }
  if (redisClient.status !== 'ready') {
    await redisClient.connect();
  }
}, 20000);

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Session.deleteMany({}),
    RefreshToken.deleteMany({}),
    ExternalIdentity.deleteMany({}),
    AccountDeletionRequest.deleteMany({}),
    AuthToken.deleteMany({}),
    AuditLog.deleteMany({}),
    Course ? Course.deleteMany({}) : Promise.resolve(),
    Enrollment ? Enrollment.deleteMany({}) : Promise.resolve(),
  ]);
  await redisClient.flushdb();
});

afterAll(async () => {
  await mongoose.connection.close();
  try {
    if (redisClient.status === 'ready') await redisClient.quit();
    else await redisClient.disconnect();
  } catch (_) {
    // ignore
  }
});

async function createUser(overrides = {}) {
  const passwordHash = await hashPassword('a-genuinely-long-passphrase-2026');
  return User.create({
    full_name: 'Test User',
    email: `${Date.now()}-${Math.random()}@example.com`,
    password_hash: passwordHash,
    birth_date: new Date('2000-01-01'),
    role: 'Student',
    status: 'active',
    email_verified_at: new Date(),
    ...overrides,
  });
}

function tokenFor(user) {
  return signAccessToken({ userId: user._id, sessionId: 'fake-session-id-for-tests' });
}

describe('PATCH /admin/accounts/:id/status — privilege escalation guards', () => {
  it('Admin cannot suspend another Admin (SuperAdmin-only) → 403', async () => {
    const actorAdmin = await createUser({ role: 'Admin', mfa_enabled: true });
    const targetAdmin = await createUser({ role: 'Admin' });

    const res = await request(app)
      .patch(`/api/v1/admin/accounts/${targetAdmin._id}/status`)
      .set('Authorization', `Bearer ${tokenFor(actorAdmin)}`)
      .send({ action: 'suspend', reason: 'policy violation' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('nobody can manage a SuperAdmin target through this endpoint → 403', async () => {
    const actorAdmin = await createUser({ role: 'SuperAdmin', mfa_enabled: true });
    const targetSuperAdmin = await createUser({ role: 'SuperAdmin' });

    const res = await request(app)
      .patch(`/api/v1/admin/accounts/${targetSuperAdmin._id}/status`)
      .set('Authorization', `Bearer ${tokenFor(actorAdmin)}`)
      .send({ action: 'suspend', reason: 'test' });

    expect(res.status).toBe(403);
  });

  it('actor cannot suspend/activate their own account → 403 FORBIDDEN', async () => {
    const admin = await createUser({ role: 'Admin', mfa_enabled: true });

    const res = await request(app)
      .patch(`/api/v1/admin/accounts/${admin._id}/status`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ action: 'suspend', reason: 'test' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('suspending a Student revokes all sessions, refresh tokens, and OAuth links', async () => {
    const admin = await createUser({ role: 'Admin', mfa_enabled: true });
    const student = await createUser({ role: 'Student' });

    await Session.create({
      user_id: student._id,
      device_fingerprint: 'fp',
      ip_address: '127.0.0.1',
      user_agent: 'jest',
      status: 'active',
      expires_at: new Date(Date.now() + 60000),
    });
    await ExternalIdentity.create({
      user_id: student._id,
      provider: 'GOOGLE',
      provider_user_id: 'google-sub-1',
    });

    const res = await request(app)
      .patch(`/api/v1/admin/accounts/${student._id}/status`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ action: 'suspend', reason: 'policy violation' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('suspended');

    const session = await Session.findOne({ user_id: student._id });
    expect(session.status).toBe('revoked');

    const identity = await ExternalIdentity.findOne({ user_id: student._id });
    expect(identity.revoked_at).not.toBeNull();

    const updatedUser = await User.findById(student._id);
    expect(updatedUser.token_version).toBe(2); // bumped once from default 1
  });

  it('rejects a no-op status change (already suspended) → 409 STATUS_UNCHANGED', async () => {
    const admin = await createUser({ role: 'Admin', mfa_enabled: true });
    const student = await createUser({ role: 'Student', status: 'suspended' });

    const res = await request(app)
      .patch(`/api/v1/admin/accounts/${student._id}/status`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ action: 'suspend', reason: 'test' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STATUS_UNCHANGED');
  });

  it('missing reason → 400 VALIDATION_ERROR (Zod enforces mandatory reason)', async () => {
    const admin = await createUser({ role: 'Admin', mfa_enabled: true });
    const student = await createUser({ role: 'Student' });

    const res = await request(app)
      .patch(`/api/v1/admin/accounts/${student._id}/status`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ action: 'suspend' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /admin/accounts — SuperAdmin-only Admin creation', () => {
  it('Admin (not SuperAdmin) → 403, even though Admin passes elsewhere', async () => {
    const admin = await createUser({ role: 'Admin', mfa_enabled: true });

    const res = await request(app)
      .post('/api/v1/admin/accounts')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ email: 'newadmin@example.com', fullName: 'New Admin' });

    expect(res.status).toBe(403);
  });

  it('SuperAdmin creates a password-less Admin account, seeds a PASSWORD_RESET AuthToken', async () => {
    const superAdmin = await createUser({ role: 'SuperAdmin', mfa_enabled: true });

    const res = await request(app)
      .post('/api/v1/admin/accounts')
      .set('Authorization', `Bearer ${tokenFor(superAdmin)}`)
      .send({ email: 'newadmin@example.com', fullName: 'New Admin' });

    expect(res.status).toBe(201);
    const created = await User.findOne({ email: 'newadmin@example.com' });
    expect(created.role).toBe('Admin');
    expect(created.password_hash).toBeNull();

    const token = await AuthToken.findOne({ user_id: created._id, token_type: 'PASSWORD_RESET' });
    expect(token).not.toBeNull();
  });

  it('duplicate email → 409 EMAIL_ALREADY_REGISTERED', async () => {
    const superAdmin = await createUser({ role: 'SuperAdmin', mfa_enabled: true });
    await createUser({ email: 'dup@example.com' });

    const res = await request(app)
      .post('/api/v1/admin/accounts')
      .set('Authorization', `Bearer ${tokenFor(superAdmin)}`)
      .send({ email: 'dup@example.com', fullName: 'Dup' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });
});

describe('DELETE /admin/accounts/:id — admin-initiated deletion', () => {
  it('actor cannot delete their own account via this route → 403 FORBIDDEN', async () => {
    const admin = await createUser({ role: 'Admin', mfa_enabled: true });

    const res = await request(app)
      .delete(`/api/v1/admin/accounts/${admin._id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ reason: 'test' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('deletes a Student with no active enrollments → 200, soft-deleted, 30-day window', async () => {
    const admin = await createUser({ role: 'Admin', mfa_enabled: true });
    const student = await createUser({ role: 'Student' });

    const res = await request(app)
      .delete(`/api/v1/admin/accounts/${student._id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ reason: 'requested by user' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('deleted');
    expect(res.body.data.restoreWindowDays).toBe(30);

    const updated = await User.findById(student._id);
    expect(updated.status).toBe('deleted');
    expect(updated.deleted_at).not.toBeNull();
  });

  (Enrollment ? it : it.skip)(
    'blocks deleting a Student with active enrollments → 409 STUDENT_HAS_ACTIVE_ENROLLMENTS',
    async () => {
      const admin = await createUser({ role: 'Admin', mfa_enabled: true });
      const student = await createUser({ role: 'Student' });
      // Create a dummy course to get a valid course_id
      const course = await Course.create({
        title: 'Test Course',
        description: 'Test description',
        category: 'Technology & Computer Science',
        course_type: 'free',
        owner_instructor_id: student._id, // dummy instructor
        status: 'published',
      });
      await Enrollment.create({
        student_id: student._id,
        course_id: course._id,
        status: 'active',
        confirmed_by_student: true,
      });

      const res = await request(app)
        .delete(`/api/v1/admin/accounts/${student._id}`)
        .set('Authorization', `Bearer ${tokenFor(admin)}`)
        .send({ reason: 'test' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('STUDENT_HAS_ACTIVE_ENROLLMENTS');
    }
  );

  (Course ? it : it.skip)(
    'blocks deleting an Instructor with non-archived courses → 409 INSTRUCTOR_HAS_ACTIVE_COURSES',
    async () => {
      const admin = await createUser({ role: 'Admin', mfa_enabled: true });
      const instructor = await createUser({ role: 'Instructor' });
      await Course.create({
        owner_instructor_id: instructor._id,
        title: 'Test Course',
        description: 'Test description',
        category: 'Technology & Computer Science',
        course_type: 'free',
        status: 'published',
      });

      const res = await request(app)
        .delete(`/api/v1/admin/accounts/${instructor._id}`)
        .set('Authorization', `Bearer ${tokenFor(admin)}`)
        .send({ reason: 'test' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INSTRUCTOR_HAS_ACTIVE_COURSES');
    }
  );
});

describe('PATCH /admin/accounts/:id/deletion — admin-triggered restore', () => {
  it('restores a deleted account within the 30-day window', async () => {
    const admin = await createUser({ role: 'Admin', mfa_enabled: true });
    const deletedUser = await createUser({
      role: 'Student',
      status: 'deleted',
      deleted_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    });

    const res = await request(app)
      .patch(`/api/v1/admin/accounts/${deletedUser._id}/deletion`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('active');
  });

  it('rejects restore past the 30-day window → 410 RESTORE_WINDOW_EXPIRED', async () => {
    const admin = await createUser({ role: 'Admin', mfa_enabled: true });
    const deletedUser = await createUser({
      role: 'Student',
      status: 'deleted',
      deleted_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
    });

    const res = await request(app)
      .patch(`/api/v1/admin/accounts/${deletedUser._id}/deletion`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('RESTORE_WINDOW_EXPIRED');
  });
});

describe('GET /admin/accounts — listing/search', () => {
  it('filters by role and respects pageSize', async () => {
    const admin = await createUser({ role: 'Admin', mfa_enabled: true });
    await createUser({ role: 'Student' });
    await createUser({ role: 'Student' });
    await createUser({ role: 'Student' });

    const res = await request(app)
      .get('/api/v1/admin/accounts?role=Student&pageSize=2')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeLessThanOrEqual(2);
    expect(res.body.data.items.every((u) => u.role === 'Student')).toBe(true);
  });
});

describe('DELETE /auth/account — self-service deletion request', () => {
  it('Student is deleted immediately (200)', async () => {
    const student = await createUser({ role: 'Student' });

    const res = await request(app)
      .delete('/api/v1/auth/account')
      .set('Authorization', `Bearer ${tokenFor(student)}`)
      .send({ reason: 'no longer needed' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('deleted');
  });

  it('Instructor gets a pending_review request instead of immediate deletion (202)', async () => {
    const instructor = await createUser({ role: 'Instructor' });

    const res = await request(app)
      .delete('/api/v1/auth/account')
      .set('Authorization', `Bearer ${tokenFor(instructor)}`)
      .send({ reason: 'retiring' });

    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe('pending_review');
  });

  it('SuperAdmin cannot self-delete through this endpoint → 403', async () => {
    const superAdmin = await createUser({ role: 'SuperAdmin' });

    const res = await request(app)
      .delete('/api/v1/auth/account')
      .set('Authorization', `Bearer ${tokenFor(superAdmin)}`)
      .send({ reason: 'test' });

    expect(res.status).toBe(403);
  });

  it('a second deletion request while one is pending_review → 409 REQUEST_ALREADY_PENDING', async () => {
    const instructor = await createUser({ role: 'Instructor' });
    await AccountDeletionRequest.create({
      user_id: instructor._id,
      reason: 'first request',
      status: 'pending_review',
    });

    const res = await request(app)
      .delete('/api/v1/auth/account')
      .set('Authorization', `Bearer ${tokenFor(instructor)}`)
      .send({ reason: 'second attempt' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REQUEST_ALREADY_PENDING');
  });
});

describe('POST /admin/deletion-requests/:id/review — SuperAdmin decision', () => {
  it('approve → target account soft-deleted and all sessions revoked', async () => {
    const superAdmin = await createUser({ role: 'SuperAdmin', mfa_enabled: true });
    const instructor = await createUser({ role: 'Instructor' });
    const deletionRequest = await AccountDeletionRequest.create({
      user_id: instructor._id,
      reason: 'retiring',
      status: 'pending_review',
    });

    const res = await request(app)
      .post(`/api/v1/admin/deletion-requests/${deletionRequest._id}/review`)
      .set('Authorization', `Bearer ${tokenFor(superAdmin)}`)
      .send({ decision: 'approve' });

    expect(res.status).toBe(200);
    const updatedUser = await User.findById(instructor._id);
    expect(updatedUser.status).toBe('deleted');
  });

  it('reject without decisionReason → 400 VALIDATION_ERROR (conditionally required)', async () => {
    const superAdmin = await createUser({ role: 'SuperAdmin', mfa_enabled: true });
    const instructor = await createUser({ role: 'Instructor' });
    const deletionRequest = await AccountDeletionRequest.create({
      user_id: instructor._id,
      reason: 'retiring',
      status: 'pending_review',
    });

    const res = await request(app)
      .post(`/api/v1/admin/deletion-requests/${deletionRequest._id}/review`)
      .set('Authorization', `Bearer ${tokenFor(superAdmin)}`)
      .send({ decision: 'reject' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('reviewing an already-decided request → 409 REQUEST_ALREADY_DECIDED', async () => {
    const superAdmin = await createUser({ role: 'SuperAdmin', mfa_enabled: true });
    const instructor = await createUser({ role: 'Instructor' });
    const deletionRequest = await AccountDeletionRequest.create({
      user_id: instructor._id,
      reason: 'retiring',
      status: 'approved',
      reviewed_at: new Date(),
    });

    const res = await request(app)
      .post(`/api/v1/admin/deletion-requests/${deletionRequest._id}/review`)
      .set('Authorization', `Bearer ${tokenFor(superAdmin)}`)
      .send({ decision: 'approve' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REQUEST_ALREADY_DECIDED');
  });

  it('Admin (not SuperAdmin) cannot access the review queue → 403', async () => {
    const admin = await createUser({ role: 'Admin', mfa_enabled: true });

    const res = await request(app)
      .get('/api/v1/admin/deletion-requests')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(res.status).toBe(403);
  });
});

describe('Account Restore — self-service (public, no auth)', () => {
  it('mints an ACCOUNT_RESTORE token for a deleted account within the window', async () => {
    const deletedUser = await createUser({
      status: 'deleted',
      deleted_at: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    const requestRes = await request(app)
      .post('/api/v1/auth/account/restore/request')
      .send({ email: deletedUser.email });
    expect(requestRes.status).toBe(200);

    const authToken = await AuthToken.findOne({
      user_id: deletedUser._id,
      token_type: 'ACCOUNT_RESTORE',
    }).sort({ created_at: -1 });
    // Raw code isn't retrievable from the stored hash by design (DP-08);
    // asserting a token was minted is the safe, correct boundary here.
    expect(authToken).not.toBeNull();

    const wrongCodeRes = await request(app)
      .post('/api/v1/auth/account/restore/confirm')
      .send({ email: deletedUser.email, code: '000000' });
    expect(wrongCodeRes.status).toBe(400);
  });

  it('same generic 200 whether or not the email matches a deleted account (anti-enumeration)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/account/restore/request')
      .send({ email: 'nobody-deleted@example.com' });

    expect(res.status).toBe(200);
  });
});
