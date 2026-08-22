/**
 * Integration tests for PAY module: eligibility, payment initiation
 * (real Stripe Sandbox calls where noted), webhook processing (signed
 * locally via stripe.webhooks.generateTestHeaderString — no network),
 * and the simplified refund flow (no escalation).
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const User = require('../../src/models/User');
const Course = require('../../src/models/Course');
const Enrollment = require('../../src/models/Enrollment');
const Payment = require('../../src/models/Payment');
const RefundRequest = require('../../src/models/RefundRequest');
const Invoice = require('../../src/models/Invoice');
const ProcessedWebhookEvent = require('../../src/models/ProcessedWebhookEvent');
const Session = require('../../src/models/Session');
const { hashPassword } = require('../../src/utils/crypto');
const redisClient = require('../../src/config/redis');
const { signAccessToken } = require('../../src/utils/jwt');
const stripe = require('../../src/config/stripe');
const env = require('../../src/config/env');
const emailService = require('../../src/services/emailService');
const Audit = require('../../src/models/AuditLog');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
const PLAIN_PASSWORD = 'a-genuinely-long-passphrase-2026';

jest.setTimeout(20000);

// ------------------------------------------------------------------
// Helper: build signed Stripe webhook request
// ------------------------------------------------------------------
function buildSignedRequest(payloadObject) {
  const payloadString = JSON.stringify(payloadObject);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: payloadString,
    secret: env.stripe.webhookSecret,
  });
  return { payloadString, signature };
}

// ------------------------------------------------------------------
// Global setup / teardown
// ------------------------------------------------------------------
beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI);
  }
  if (redisClient.status !== 'ready') {
    await redisClient.connect();
  }
});

beforeEach(async () => {
  // Clear all collections
  await Promise.all([
    User.deleteMany({}),
    Course.deleteMany({}),
    Enrollment.deleteMany({}),
    Payment.deleteMany({}),
    RefundRequest.deleteMany({}),
    Invoice.deleteMany({}),
    ProcessedWebhookEvent.deleteMany({}),
    Session.deleteMany({}),
    Audit.deleteMany({}),
  ]);
  await redisClient.flushdb();

  // Restore all mocks to avoid cross-test contamination
  jest.restoreAllMocks();
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
  try {
    if (redisClient.status === 'ready') {
      await redisClient.quit();
    } else {
      await redisClient.disconnect();
    }
  } catch (_) {
    /* ignore */
  }
  if (app && typeof app.close === 'function') {
    await new Promise((resolve) => app.close(resolve));
  }
});

// ------------------------------------------------------------------
// Helper: create user and return access token
// ------------------------------------------------------------------
async function createUserAndLogin(overrides = {}) {
  const passwordHash = await hashPassword(PLAIN_PASSWORD);
  const user = await User.create({
    full_name: overrides.full_name || 'Test User',
    email: overrides.email || `user-${Date.now()}-${Math.random()}@example.com`,
    password_hash: passwordHash,
    birth_date: new Date('1990-01-01'),
    role: overrides.role || 'Student',
    status: overrides.status || 'active',
    email_verified_at: new Date(),
    kyc_status: 'verified',
    mfa_enabled: true,
    privacy_consent: {
      policy_version: 'v1.0',
      accepted_at: new Date(),
      ip: '127.0.0.1',
      user_agent: 'jest',
    },
  });

  const session = await Session.create({
    user_id: user._id,
    device_fingerprint: 'test-fingerprint',
    ip_address: '127.0.0.1',
    user_agent: 'jest',
    mfa_verified: false,
    status: 'active',
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  const accessToken = signAccessToken({ userId: user._id, sessionId: session._id });
  return { accessToken, user };
}

async function createPaidCourseWithPendingEnrollment(studentId, instructorId) {
  const course = await Course.create({
    title: 'Paid Course',
    description: 'desc',
    category: 'Technology & Computer Science',
    course_type: 'paid',
    price: 49.99,
    is_synchronous: false,
    owner_instructor_id: instructorId,
    status: 'published',
  });
  const enrollment = await Enrollment.create({
    course_id: course._id,
    student_id: studentId,
    status: 'pending_payment',
    confirmed_by_student: true,
  });
  return { course, enrollment };
}

// ------------------------------------------------------------------
// Test suites
// ------------------------------------------------------------------

describe('POST /api/v1/pay/initiate — eligibility (no live Stripe call)', () => {
  it('rejects with 404 ENROLLMENT_NOT_FOUND for a non-existent enrollment', async () => {
    const student = await createUserAndLogin();
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request(app)
      .post('/api/v1/pay/initiate')
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ enrollment_id: fakeId.toString() });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ENROLLMENT_NOT_FOUND');
  });

  it('rejects with 400 COURSE_NOT_AVAILABLE if the course is no longer published', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const { enrollment, course } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );
    course.status = 'suspended';
    await course.save();

    const res = await request(app)
      .post('/api/v1/pay/initiate')
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ enrollment_id: enrollment._id.toString() });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('COURSE_NOT_AVAILABLE');
  });

  it('rejects with 409 ALREADY_PAID if a paid Payment already exists for this enrollment', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const { enrollment, course } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );
    await Payment.create({
      student_id: student.user._id,
      course_id: course._id,
      enrollment_id: enrollment._id,
      amount: 49.99,
      currency: 'usd',
      status: 'paid',
      idempotency_key: `${student.user._id}:${course._id}`,
    });

    const res = await request(app)
      .post('/api/v1/pay/initiate')
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ enrollment_id: enrollment._id.toString() });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_PAID');
  });

  it('rejects with 403 STUDENT_NOT_ELIGIBLE if student.status is not active', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin({ status: 'suspended' });
    const { enrollment } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );

    const res = await request(app)
      .post('/api/v1/pay/initiate')
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ enrollment_id: enrollment._id.toString() });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STUDENT_NOT_ELIGIBLE');
  });
});

describe('POST /api/v1/pay/initiate — success path (LIVE Stripe Sandbox)', () => {
  it('creates a Payment(pending) and returns a real Stripe Checkout URL', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const { enrollment } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );

    const res = await request(app)
      .post('/api/v1/pay/initiate')
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ enrollment_id: enrollment._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.data.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//);

    const payment = await Payment.findOne({ enrollment_id: enrollment._id });
    expect(payment.status).toBe('pending');
    expect(payment.gateway_session_id).toBeTruthy();
  }, 15000);

  it('reuses the same open Checkout Session on a repeated call (idempotency)', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const { enrollment } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );

    const first = await request(app)
      .post('/api/v1/pay/initiate')
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ enrollment_id: enrollment._id.toString() });

    const second = await request(app)
      .post('/api/v1/pay/initiate')
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ enrollment_id: enrollment._id.toString() });

    expect(second.status).toBe(200);
    expect(second.body.data.checkoutUrl).toBe(first.body.data.checkoutUrl);

    const paymentsCount = await Payment.countDocuments({ enrollment_id: enrollment._id });
    expect(paymentsCount).toBe(1);
  }, 20000);

  it('creates a new Stripe session when existing Payment has status failed', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const { enrollment, course } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );

    const idempotencyKey = `${student.user._id}:${course._id}`;
    await Payment.create({
      student_id: student.user._id,
      course_id: course._id,
      enrollment_id: enrollment._id,
      amount: 49.99,
      currency: 'usd',
      status: 'failed',
      idempotency_key: idempotencyKey,
      gateway_session_id: 'cs_test_failed',
    });

    const res = await request(app)
      .post('/api/v1/pay/initiate')
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ enrollment_id: enrollment._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.data.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//);

    const payment = await Payment.findOne({ idempotency_key: idempotencyKey });
    expect(payment.gateway_session_id).not.toBe('cs_test_failed');
    const paymentsCount = await Payment.countDocuments({ idempotency_key: idempotencyKey });
    expect(paymentsCount).toBe(1);
  });
});

describe('POST /api/v1/pay/webhook — signature verification', () => {
  it('rejects with 401 WEBHOOK_SIGNATURE_INVALID for a forged signature', async () => {
    const payloadString = JSON.stringify({
      id: 'evt_fake',
      object: 'event',
      type: 'checkout.session.completed',
    });

    const res = await request(app)
      .post('/api/v1/pay/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 't=1,v1=forged_signature_value')
      .send(payloadString);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
  });

  it('rejects with 400 MISSING_SIGNATURE when the header is absent', async () => {
    const res = await request(app)
      .post('/api/v1/pay/webhook')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ id: 'evt_fake', object: 'event' }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_SIGNATURE');
  });

  it('checkout.session.completed: activates enrollment, marks Payment paid, generates an Invoice', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const { enrollment, course } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );
    const payment = await Payment.create({
      student_id: student.user._id,
      course_id: course._id,
      enrollment_id: enrollment._id,
      amount: 49.99,
      currency: 'usd',
      status: 'pending',
      idempotency_key: `${student.user._id}:${course._id}`,
      gateway_session_id: 'cs_test_fake123',
    });

    const eventPayload = {
      id: `evt_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_fake123',
          object: 'checkout.session',
          payment_intent: 'pi_test_fake123',
          metadata: {
            payment_id: payment._id.toString(),
            enrollment_id: enrollment._id.toString(),
          },
        },
      },
    };
    const { payloadString, signature } = buildSignedRequest(eventPayload);

    const res = await request(app)
      .post('/api/v1/pay/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payloadString);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const updatedPayment = await Payment.findById(payment._id);
    expect(updatedPayment.status).toBe('paid');
    expect(updatedPayment.gateway_payment_intent_id).toBe('pi_test_fake123');

    const updatedEnrollment = await Enrollment.findById(enrollment._id);
    expect(updatedEnrollment.status).toBe('active');

    const invoice = await Invoice.findOne({ payment_id: payment._id });
    expect(invoice).not.toBeNull();
    expect(invoice.invoice_number).toMatch(/^INV-/);
  });

  it('ignores a REDELIVERED event (same event.id) without reprocessing', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const { enrollment, course } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );
    const payment = await Payment.create({
      student_id: student.user._id,
      course_id: course._id,
      enrollment_id: enrollment._id,
      amount: 49.99,
      currency: 'usd',
      status: 'pending',
      idempotency_key: `${student.user._id}:${course._id}`,
      gateway_session_id: 'cs_test_dup',
    });

    const eventPayload = {
      id: 'evt_fixed_id_for_dup_test',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_dup',
          payment_intent: 'pi_test_dup',
          metadata: { payment_id: payment._id.toString() },
        },
      },
    };
    const { payloadString, signature } = buildSignedRequest(eventPayload);

    await request(app)
      .post('/api/v1/pay/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payloadString);
    const secondDelivery = await request(app)
      .post('/api/v1/pay/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payloadString);

    expect(secondDelivery.status).toBe(200);

    const invoiceCount = await Invoice.countDocuments({ payment_id: payment._id });
    expect(invoiceCount).toBe(1);

    const eventCount = await ProcessedWebhookEvent.countDocuments({
      event_id: 'evt_fixed_id_for_dup_test',
    });
    expect(eventCount).toBe(1);
  });

  it('checkout.session.expired: marks Payment failed, does NOT activate enrollment', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const { enrollment, course } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );
    const payment = await Payment.create({
      student_id: student.user._id,
      course_id: course._id,
      enrollment_id: enrollment._id,
      amount: 49.99,
      currency: 'usd',
      status: 'pending',
      idempotency_key: `${student.user._id}:${course._id}`,
      gateway_session_id: 'cs_test_expired',
    });

    const eventPayload = {
      id: `evt_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.expired',
      data: { object: { id: 'cs_test_expired', metadata: { payment_id: payment._id.toString() } } },
    };
    const { payloadString, signature } = buildSignedRequest(eventPayload);

    const res = await request(app)
      .post('/api/v1/pay/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payloadString);

    expect(res.status).toBe(200);

    const updatedPayment = await Payment.findById(payment._id);
    expect(updatedPayment.status).toBe('failed');

    const unchangedEnrollment = await Enrollment.findById(enrollment._id);
    expect(unchangedEnrollment.status).toBe('pending_payment');
  });

  it('handles payment_intent.payment_failed', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const { enrollment, course } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );
    const payment = await Payment.create({
      student_id: student.user._id,
      course_id: course._id,
      enrollment_id: enrollment._id,
      amount: 49.99,
      currency: 'usd',
      status: 'pending',
      idempotency_key: `${student.user._id}:${course._id}`,
      gateway_session_id: 'cs_test_fail',
    });

    const eventPayload = {
      id: `evt_${Date.now()}`,
      object: 'event',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_test_fail',
          metadata: { payment_id: payment._id.toString() },
          last_payment_error: { message: 'Card declined' },
        },
      },
    };
    const { payloadString, signature } = buildSignedRequest(eventPayload);

    const res = await request(app)
      .post('/api/v1/pay/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payloadString);

    expect(res.status).toBe(200);

    const updatedPayment = await Payment.findById(payment._id);
    expect(updatedPayment.status).toBe('failed');
    expect(updatedPayment.failure_reason).toBe('Card declined');
  });

  it('ignores webhook event if Payment already processed (status not pending)', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const { enrollment, course } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );
    const payment = await Payment.create({
      student_id: student.user._id,
      course_id: course._id,
      enrollment_id: enrollment._id,
      amount: 49.99,
      currency: 'usd',
      status: 'paid',
      idempotency_key: `${student.user._id}:${course._id}`,
      gateway_session_id: 'cs_test_already_paid',
    });

    const eventPayload = {
      id: `evt_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_already_paid',
          payment_intent: 'pi_test_already_paid',
          metadata: { payment_id: payment._id.toString() },
        },
      },
    };
    const { payloadString, signature } = buildSignedRequest(eventPayload);

    const res = await request(app)
      .post('/api/v1/pay/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payloadString);

    expect(res.status).toBe(200);
    const invoiceCount = await Invoice.countDocuments({ payment_id: payment._id });
    expect(invoiceCount).toBe(0);
  });

  it('ignores webhook when payment_id not found in metadata', async () => {
    const eventPayload = {
      id: `evt_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_no_meta', metadata: {} } },
    };
    const { payloadString, signature } = buildSignedRequest(eventPayload);

    const res = await request(app)
      .post('/api/v1/pay/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payloadString);

    expect(res.status).toBe(200);
  });
});

describe('Invoice generation – edge cases', () => {
  it('logs an audit entry if invoice email sending fails', async () => {
    jest.spyOn(emailService, 'sendInvoiceEmail').mockRejectedValue(new Error('SMTP error'));

    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const { enrollment, course } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );
    const payment = await Payment.create({
      student_id: student.user._id,
      course_id: course._id,
      enrollment_id: enrollment._id,
      amount: 49.99,
      currency: 'usd',
      status: 'pending',
      idempotency_key: `${student.user._id}:${course._id}`,
      gateway_session_id: 'cs_test_email_fail',
    });

    const eventPayload = {
      id: `evt_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_email_fail',
          payment_intent: 'pi_test_email_fail',
          metadata: { payment_id: payment._id.toString() },
        },
      },
    };
    const { payloadString, signature } = buildSignedRequest(eventPayload);

    await request(app)
      .post('/api/v1/pay/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payloadString);

    const failedAudit = await Audit.findOne({ action: 'INVOICE_EMAIL_SEND_FAILED' });
    expect(failedAudit).not.toBeNull();
    expect(failedAudit.metadata.error).toContain('SMTP error');

    emailService.sendInvoiceEmail.mockRestore();
  });

  it('skips sending email if student has no email', async () => {
    const mockStudent = { full_name: 'No Email', email: null };
    jest.spyOn(User, 'findById').mockResolvedValueOnce(mockStudent);

    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const { enrollment, course } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );
    const payment = await Payment.create({
      student_id: student.user._id,
      course_id: course._id,
      enrollment_id: enrollment._id,
      amount: 49.99,
      currency: 'usd',
      status: 'pending',
      idempotency_key: `${student.user._id}:${course._id}`,
      gateway_session_id: 'cs_test_no_email',
    });

    const emailSpy = jest.spyOn(emailService, 'sendInvoiceEmail');

    const eventPayload = {
      id: `evt_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_no_email',
          payment_intent: 'pi_test_no_email',
          metadata: { payment_id: payment._id.toString() },
        },
      },
    };
    const { payloadString, signature } = buildSignedRequest(eventPayload);

    await request(app)
      .post('/api/v1/pay/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payloadString);

    expect(emailSpy).not.toHaveBeenCalled();

    User.findById.mockRestore();
    emailSpy.mockRestore();
  });
});

describe('GET /api/v1/pay/payments/:paymentId', () => {
  it('returns payment details for the student who owns it', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const { enrollment, course } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );
    const payment = await Payment.create({
      student_id: student.user._id,
      course_id: course._id,
      enrollment_id: enrollment._id,
      amount: 49.99,
      currency: 'usd',
      status: 'paid',
      paid_at: new Date(),
      idempotency_key: `${student.user._id}:${course._id}`,
    });

    const res = await request(app)
      .get(`/api/v1/pay/payments/${payment._id}`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.payment._id).toBe(payment._id.toString());
  });

  it("returns 404 for a student trying to access another student's payment", async () => {
    const student1 = await createUserAndLogin();
    const student2 = await createUserAndLogin();
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const { enrollment, course } = await createPaidCourseWithPendingEnrollment(
      student1.user._id,
      instructor.user._id
    );
    const payment = await Payment.create({
      student_id: student1.user._id,
      course_id: course._id,
      enrollment_id: enrollment._id,
      amount: 49.99,
      currency: 'usd',
      status: 'paid',
      idempotency_key: `${student1.user._id}:${course._id}`,
    });

    const res = await request(app)
      .get(`/api/v1/pay/payments/${payment._id}`)
      .set('Authorization', `Bearer ${student2.accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PAYMENT_NOT_FOUND');
  });
});

describe('GET /api/v1/pay/my-payments', () => {
  it("returns a paginated list of the student's payments", async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const { enrollment, course } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );
    await Payment.create({
      student_id: student.user._id,
      course_id: course._id,
      enrollment_id: enrollment._id,
      amount: 49.99,
      currency: 'usd',
      status: 'paid',
      idempotency_key: `${student.user._id}:${course._id}`,
    });

    const res = await request(app)
      .get('/api/v1/pay/my-payments')
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.payments).toHaveLength(1);
    expect(res.body.data.meta.total_records).toBe(1);
  });

  it('filters by status', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const { enrollment, course } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );
    await Payment.create({
      student_id: student.user._id,
      course_id: course._id,
      enrollment_id: enrollment._id,
      amount: 49.99,
      currency: 'usd',
      status: 'paid',
      idempotency_key: `${student.user._id}:${course._id}`,
    });
    const enrollment2 = await Enrollment.create({
      course_id: course._id,
      student_id: student.user._id,
      status: 'pending_payment',
      confirmed_by_student: true,
    });
    await Payment.create({
      student_id: student.user._id,
      course_id: course._id,
      enrollment_id: enrollment2._id,
      amount: 49.99,
      currency: 'usd',
      status: 'pending',
      idempotency_key: `${student.user._id}:${course._id}:pending`,
    });

    const res = await request(app)
      .get('/api/v1/pay/my-payments?status=paid')
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.payments).toHaveLength(1);
    expect(res.body.data.payments[0].status).toBe('paid');
  });

  it('attaches refund_request info', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const { enrollment, course } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );
    const payment = await Payment.create({
      student_id: student.user._id,
      course_id: course._id,
      enrollment_id: enrollment._id,
      amount: 49.99,
      currency: 'usd',
      status: 'paid',
      idempotency_key: `${student.user._id}:${course._id}`,
    });
    await RefundRequest.create({
      payment_id: payment._id,
      student_id: student.user._id,
      status: 'review_pending',
      idempotency_key: `refund:${payment._id}`,
    });

    const res = await request(app)
      .get('/api/v1/pay/my-payments')
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.payments[0].refund_request).not.toBeNull();
    expect(res.body.data.payments[0].refund_request.status).toBe('review_pending');
  });
});

describe('GET /api/v1/pay/refund-requests (admin)', () => {
  it('lists refund requests with default status=review_pending', async () => {
    const admin = await createUserAndLogin({ role: 'Admin' });
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const { enrollment, course } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );
    const payment = await Payment.create({
      student_id: student.user._id,
      course_id: course._id,
      enrollment_id: enrollment._id,
      amount: 49.99,
      currency: 'usd',
      status: 'paid',
      idempotency_key: `${student.user._id}:${course._id}`,
    });
    await RefundRequest.create({
      payment_id: payment._id,
      student_id: student.user._id,
      status: 'review_pending',
      idempotency_key: `refund:${payment._id}`,
    });

    const res = await request(app)
      .get('/api/v1/pay/refund-requests')
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.refundRequests).toHaveLength(1);
    expect(res.body.data.refundRequests[0].status).toBe('review_pending');
  });

  it('filters by status query param', async () => {
    const admin = await createUserAndLogin({ role: 'Admin' });
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const { enrollment, course } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );
    const payment = await Payment.create({
      student_id: student.user._id,
      course_id: course._id,
      enrollment_id: enrollment._id,
      amount: 49.99,
      currency: 'usd',
      status: 'paid',
      idempotency_key: `${student.user._id}:${course._id}`,
    });
    await RefundRequest.create({
      payment_id: payment._id,
      student_id: student.user._id,
      status: 'approved',
      idempotency_key: `refund:${payment._id}`,
    });

    const res = await request(app)
      .get('/api/v1/pay/refund-requests?status=approved')
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.refundRequests).toHaveLength(1);
    expect(res.body.data.refundRequests[0].status).toBe('approved');
  });

  it('paginates correctly', async () => {
    const admin = await createUserAndLogin({ role: 'Admin' });
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const { enrollment, course } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );
    for (let i = 0; i < 3; i++) {
      const payment = await Payment.create({
        student_id: student.user._id,
        course_id: course._id,
        enrollment_id: enrollment._id,
        amount: 49.99,
        currency: 'usd',
        status: 'paid',
        idempotency_key: `${student.user._id}:${course._id}:${i}`,
      });
      await RefundRequest.create({
        payment_id: payment._id,
        student_id: student.user._id,
        status: 'review_pending',
        idempotency_key: `refund:${payment._id}`,
      });
    }

    const res = await request(app)
      .get('/api/v1/pay/refund-requests?page=1&limit=2')
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.refundRequests).toHaveLength(2);
    expect(res.body.data.meta.total_records).toBe(3);
    expect(res.body.data.meta.total_pages).toBe(2);
  });
});

describe('POST /api/v1/pay/refund-requests (UC-PAY-09)', () => {
  async function createPaidPayment(studentId, courseId, enrollmentId, paidAt = new Date()) {
    return Payment.create({
      student_id: studentId,
      course_id: courseId,
      enrollment_id: enrollmentId,
      amount: 49.99,
      currency: 'usd',
      status: 'paid',
      paid_at: paidAt,
      idempotency_key: `${studentId}:${courseId}`,
      gateway_payment_intent_id: 'pi_test_refund',
    });
  }

  it('creates a review_pending refund request within the 10-business-day window', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const { enrollment, course } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );
    const payment = await createPaidPayment(
      student.user._id,
      course._id,
      enrollment._id,
      new Date()
    );

    const res = await request(app)
      .post('/api/v1/pay/refund-requests')
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ payment_id: payment._id.toString(), reason: 'Changed my mind.' });

    expect(res.status).toBe(201);
    expect(res.body.data.refundRequest.status).toBe('review_pending');
  });

  it('rejects with 400 REFUND_WINDOW_EXPIRED after 10 business days have passed', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const { enrollment, course } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    const payment = await createPaidPayment(
      student.user._id,
      course._id,
      enrollment._id,
      twentyDaysAgo
    );

    const res = await request(app)
      .post('/api/v1/pay/refund-requests')
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ payment_id: payment._id.toString() });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('REFUND_WINDOW_EXPIRED');
  });

  it('rejects a duplicate refund request for the same payment with 409', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const { enrollment, course } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );
    const payment = await createPaidPayment(student.user._id, course._id, enrollment._id);

    await request(app)
      .post('/api/v1/pay/refund-requests')
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ payment_id: payment._id.toString() });
    const secondAttempt = await request(app)
      .post('/api/v1/pay/refund-requests')
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ payment_id: payment._id.toString() });

    expect(secondAttempt.status).toBe(409);
    expect(secondAttempt.body.error.code).toBe('REFUND_ALREADY_REQUESTED');
  });

  it('returns 404 if payment does not exist for student', async () => {
    const student = await createUserAndLogin();
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .post('/api/v1/pay/refund-requests')
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ payment_id: fakeId.toString() });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PAYMENT_NOT_FOUND');
  });

  it('returns 400 if payment is not paid', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const { enrollment, course } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );
    const payment = await Payment.create({
      student_id: student.user._id,
      course_id: course._id,
      enrollment_id: enrollment._id,
      amount: 49.99,
      currency: 'usd',
      status: 'pending',
      idempotency_key: `${student.user._id}:${course._id}`,
    });

    const res = await request(app)
      .post('/api/v1/pay/refund-requests')
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ payment_id: payment._id.toString() });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PAYMENT_NOT_REFUNDABLE');
  });
});

describe('POST /api/v1/pay/refund-requests/:id/review — approve (LIVE Stripe Sandbox)', () => {
  async function createRealSucceededPaymentIntent(amountInCents) {
    return stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'usd',
      payment_method: 'pm_card_visa',
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    });
  }

  it('approves a refund request, actually refunds via Stripe, cancels Enrollment', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const admin = await createUserAndLogin({ role: 'Admin' });
    const { enrollment, course } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );
    enrollment.status = 'active';
    await enrollment.save();

    const realPaymentIntent = await createRealSucceededPaymentIntent(4999);
    expect(realPaymentIntent.status).toBe('succeeded');

    const payment = await Payment.create({
      student_id: student.user._id,
      course_id: course._id,
      enrollment_id: enrollment._id,
      amount: 49.99,
      currency: 'usd',
      status: 'paid',
      paid_at: new Date(),
      idempotency_key: `${student.user._id}:${course._id}`,
      gateway_payment_intent_id: realPaymentIntent.id,
    });
    const refundRequest = await RefundRequest.create({
      payment_id: payment._id,
      student_id: student.user._id,
      status: 'review_pending',
      idempotency_key: `refund:${payment._id}`,
    });

    const res = await request(app)
      .post(`/api/v1/pay/refund-requests/${refundRequest._id}/review`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ decision: 'approve', decision_reason: 'Valid request, within policy.' });

    expect(res.status).toBe(200);
    expect(res.body.data.refundRequest.status).toBe('approved');

    const updatedPayment = await Payment.findById(payment._id);
    expect(updatedPayment.status).toBe('refunded');

    const updatedEnrollment = await Enrollment.findById(enrollment._id);
    expect(updatedEnrollment.status).toBe('cancelled');

    const refunds = await stripe.refunds.list({ payment_intent: realPaymentIntent.id });
    expect(refunds.data).toHaveLength(1);
    expect(refunds.data[0].status).toBe('succeeded');
  }, 20000);

  it('rejects with 409 ALREADY_REVIEWED on a second review attempt', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const admin = await createUserAndLogin({ role: 'Admin' });
    const { enrollment, course } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );
    const realPaymentIntent = await createRealSucceededPaymentIntent(4999);

    const payment = await Payment.create({
      student_id: student.user._id,
      course_id: course._id,
      enrollment_id: enrollment._id,
      amount: 49.99,
      currency: 'usd',
      status: 'paid',
      paid_at: new Date(),
      idempotency_key: `${student.user._id}:${course._id}`,
      gateway_payment_intent_id: realPaymentIntent.id,
    });
    const refundRequest = await RefundRequest.create({
      payment_id: payment._id,
      student_id: student.user._id,
      status: 'review_pending',
      idempotency_key: `refund:${payment._id}`,
    });

    await request(app)
      .post(`/api/v1/pay/refund-requests/${refundRequest._id}/review`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ decision: 'approve' });
    const secondReview = await request(app)
      .post(`/api/v1/pay/refund-requests/${refundRequest._id}/review`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ decision: 'reject' });

    expect(secondReview.status).toBe(409);
    expect(secondReview.body.error.code).toBe('ALREADY_REVIEWED');
  }, 20000);

  it('rejects a refund request (sets status to rejected)', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const admin = await createUserAndLogin({ role: 'Admin' });
    const { enrollment, course } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );
    const payment = await Payment.create({
      student_id: student.user._id,
      course_id: course._id,
      enrollment_id: enrollment._id,
      amount: 49.99,
      currency: 'usd',
      status: 'paid',
      paid_at: new Date(),
      idempotency_key: `${student.user._id}:${course._id}`,
      gateway_payment_intent_id: 'pi_test_reject',
    });
    const refundRequest = await RefundRequest.create({
      payment_id: payment._id,
      student_id: student.user._id,
      status: 'review_pending',
      idempotency_key: `refund:${payment._id}`,
    });

    const res = await request(app)
      .post(`/api/v1/pay/refund-requests/${refundRequest._id}/review`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ decision: 'reject', decision_reason: 'Not eligible' });

    expect(res.status).toBe(200);
    expect(res.body.data.refundRequest.status).toBe('rejected');

    const updatedPayment = await Payment.findById(payment._id);
    expect(updatedPayment.status).toBe('paid');
  });

  it('returns 400 for invalid decision value (validation catches it)', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const admin = await createUserAndLogin({ role: 'Admin' });
    const { enrollment, course } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );
    const payment = await Payment.create({
      student_id: student.user._id,
      course_id: course._id,
      enrollment_id: enrollment._id,
      amount: 49.99,
      currency: 'usd',
      status: 'paid',
      idempotency_key: `${student.user._id}:${course._id}`,
    });
    const refundRequest = await RefundRequest.create({
      payment_id: payment._id,
      student_id: student.user._id,
      status: 'review_pending',
      idempotency_key: `refund:${payment._id}`,
    });

    const res = await request(app)
      .post(`/api/v1/pay/refund-requests/${refundRequest._id}/review`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ decision: 'invalid' });

    expect(res.status).toBe(400);
    // The validation middleware returns VALIDATION_ERROR, not INVALID_DECISION
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 if underlying payment is no longer paid', async () => {
    const instructor = await createUserAndLogin({ role: 'Instructor' });
    const student = await createUserAndLogin();
    const admin = await createUserAndLogin({ role: 'Admin' });
    const { enrollment, course } = await createPaidCourseWithPendingEnrollment(
      student.user._id,
      instructor.user._id
    );
    const payment = await Payment.create({
      student_id: student.user._id,
      course_id: course._id,
      enrollment_id: enrollment._id,
      amount: 49.99,
      currency: 'usd',
      status: 'refunded',
      idempotency_key: `${student.user._id}:${course._id}`,
    });
    const refundRequest = await RefundRequest.create({
      payment_id: payment._id,
      student_id: student.user._id,
      status: 'review_pending',
      idempotency_key: `refund:${payment._id}`,
    });

    const res = await request(app)
      .post(`/api/v1/pay/refund-requests/${refundRequest._id}/review`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ decision: 'approve' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAYMENT_NOT_REFUNDABLE');
  });
});
