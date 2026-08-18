const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const User = require('../../src/models/User');
const AuthToken = require('../../src/models/AuthToken');
const emailService = require('../../src/services/emailService');
const redisClient = require('../../src/config/redis');

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI);
  }
}, 20000);

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), AuthToken.deleteMany({})]);
  await redisClient.flushdb();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await mongoose.connection.close();
  await redisClient.quit();
});

async function createUnverifiedUser(email = 'unverified@example.com') {
  return User.create({
    full_name: 'Unverified User',
    email,
    password_hash: 'irrelevant',
    birth_date: new Date('1995-01-01'),
    role: 'Student',
    status: 'pending_email_verification',
    privacy_consent: {
      policy_version: 'v1.0',
      accepted_at: new Date(),
      ip: '127.0.0.1',
      user_agent: 'jest',
    },
  });
}

describe('POST /auth/resend-verification', () => {
  it('sends a NEW code and returns a generic success message', async () => {
    const user = await createUnverifiedUser();
    const spy = jest.spyOn(emailService, 'sendVerificationEmail');

    const res = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email: user.email });

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toMatch(/^\d{6}$/);

    const token = await AuthToken.findOne({ user_id: user._id, token_type: 'EMAIL_VERIFICATION' });
    expect(token).not.toBeNull();
  });

  it('invalidates a previously-issued still-valid code before issuing the new one (SF-AUTH-05)', async () => {
    const user = await createUnverifiedUser();
    await request(app).post('/api/v1/auth/resend-verification').send({ email: user.email });
    const firstToken = await AuthToken.findOne({
      user_id: user._id,
      token_type: 'EMAIL_VERIFICATION',
    });

    await request(app).post('/api/v1/auth/resend-verification').send({ email: user.email });
    const stillThere = await AuthToken.findById(firstToken._id);

    expect(stillThere).toBeNull();
    const count = await AuthToken.countDocuments({
      user_id: user._id,
      token_type: 'EMAIL_VERIFICATION',
    });
    expect(count).toBe(1);
  });

  it('returns the SAME 200 for a non-existent email (User Enumeration prevention)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'nobody.here@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns the SAME 200 for an ALREADY-verified email, without sending anything', async () => {
    const user = await createUnverifiedUser('already.verified@example.com');
    user.email_verified_at = new Date();
    user.status = 'active';
    await user.save();
    const spy = jest.spyOn(emailService, 'sendVerificationEmail');

    const res = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email: user.email });

    expect(res.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });

  it('is rate-limited after repeated requests (NFR-03, same pattern as /register)', async () => {
    const spamEmail = 'resend.spam.target@example.com';
    let lastResponse;
    for (let i = 0; i < 6; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      lastResponse = await request(app)
        .post('/api/v1/auth/resend-verification')
        .send({ email: spamEmail });
    }

    expect(lastResponse.status).toBe(429);
    expect(lastResponse.body.error.code).toBe('RATE_LIMITED');
  });
});
