/**
 * Integration tests — PEER module (UC-PEER-01..04 + مرحلة التسليم)
 * يغطي المسار الأساسي الكامل: إنشاء مهمة → 3 طلاب يسلّمون → توزيع →
 * 3 مراجعات → احتساب الدرجة النهائية، بالإضافة لأهم حالات الرفض.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const User = require('../../src/models/User');
const Course = require('../../src/models/Course');
const Session = require('../../src/models/Session');
const Enrollment = require('../../src/models/Enrollment');
const PeerAssignment = require('../../src/models/peerAssignment.model');
const PeerSubmission = require('../../src/models/peerSubmission.model');
const PeerReview = require('../../src/models/peerReview.model');
const { hashPassword } = require('../../src/utils/crypto');
const redisClient = require('../../src/config/redis');
const { signAccessToken } = require('../../src/utils/jwt');

const PLAIN_PASSWORD = 'a-genuinely-long-passphrase-2026';

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI);
  }
}, 20000);

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Course.deleteMany({}),
    Session.deleteMany({}),
    Enrollment.deleteMany({}),
    PeerAssignment.deleteMany({}),
    PeerSubmission.deleteMany({}),
    PeerReview.deleteMany({}),
  ]);
  if (redisClient.isOpen) await redisClient.flushdb();
});

afterAll(async () => {
  await mongoose.connection.close();
  await redisClient.quit();
});

async function createUserAndLogin({ role, email }) {
  const passwordHash = await hashPassword(PLAIN_PASSWORD);
  const user = await User.create({
    full_name: `Test ${role} ${email}`,
    email,
    password_hash: passwordHash,
    birth_date: new Date('1995-01-01'),
    role,
    status: 'active',
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
    mfa_verified: true,
    status: 'active',
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  const accessToken = signAccessToken({ userId: user._id, sessionId: session._id });
  return { accessToken, user };
}

async function createCourse(instructorId) {
  return Course.create({
    owner_instructor_id: instructorId,
    title: 'Peer Test Course',
    description: 'A course used for PEER integration tests.',
    category: 'Technology & Computer Science',
    course_type: 'free',
    is_synchronous: false,
    status: 'published',
  });
}

const RUBRIC = [
  { criterion: 'Correctness', maxScore: 10, weight: 0.6 },
  { criterion: 'Code Style', maxScore: 10, weight: 0.4 },
];

describe('PEER — full happy path', () => {
  it('creates assignment, collects submissions, distributes, reviews, and grades', async () => {
    const { accessToken: instructorToken, user: instructor } = await createUserAndLogin({
      role: 'Instructor',
      email: 'peer-instructor@test.local',
    });

    const course = await createCourse(instructor._id);

    const students = [];
    for (let i = 1; i <= 3; i += 1) {
      const { accessToken, user } = await createUserAndLogin({
        role: 'Student',
        email: `peer-student${i}@test.local`,
      });
      await Enrollment.create({
        course_id: course._id,
        student_id: user._id,
        status: 'active',
        confirmed_by_student: true,
      });
      students.push({ accessToken, user });
    }

    // UC-PEER-01 — Create Assignment (مهلة تسليم قريبة جداً كي ننتظرها في الاختبار)
    const submissionDeadline = new Date(Date.now() + 1000);
    const reviewDeadline = new Date(Date.now() + 2000);

    const createRes = await request(app)
      .post('/api/v1/peer/assignments')
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({
        courseId: course._id.toString(),
        title: 'Assignment 1 — Peer Review',
        description: 'Review your classmates solutions.',
        rubric: RUBRIC,
        submissionDeadline: submissionDeadline.toISOString(),
        reviewDeadline: reviewDeadline.toISOString(),
        reviewersPerSubmission: 1,
      });
    expect(createRes.status).toBe(201);
    const assignmentId = createRes.body.data.assignment._id;

    // 3 طلاب يسلّمون
    for (const [index, student] of students.entries()) {
      const subRes = await request(app)
        .post(`/api/v1/peer/assignments/${assignmentId}/submit`)
        .set('Authorization', `Bearer ${student.accessToken}`)
        .field('textContent', `My solution number ${index + 1}`);
      expect(subRes.status).toBe(201);
    }

    // ننتظر حتى تنتهي مهلة التسليم فعلياً
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // UC-PEER-02 — Distribute (احتياطي يدوي من المحاضر، بدل انتظار الـ Cron)
    const distributeRes = await request(app)
      .post(`/api/v1/peer/assignments/${assignmentId}/distribute`)
      .set('Authorization', `Bearer ${instructorToken}`);
    expect(distributeRes.status).toBe(200);
    expect(distributeRes.body.data.reviewCount).toBe(3); // 3 تسليمات × مراجِع واحد لكل منها

    // كل طالب يجلب مهام مراجعته ويقيّمها
    for (const student of students) {
      const tasksRes = await request(app)
        .get(`/api/v1/peer/assignments/${assignmentId}/my-reviews`)
        .set('Authorization', `Bearer ${student.accessToken}`);
      expect(tasksRes.status).toBe(200);
      expect(tasksRes.body.data.reviews.length).toBe(1);

      const reviewId = tasksRes.body.data.reviews[0].reviewId;

      // يجب ألا تُكشَف هوية صاحب العمل — فقط displaySequentialId
      const contentRes = await request(app)
        .get(`/api/v1/peer/reviews/${reviewId}/submission`)
        .set('Authorization', `Bearer ${student.accessToken}`);
      expect(contentRes.status).toBe(200);
      expect(contentRes.body.data.displaySequentialId).toBeGreaterThan(0);
      expect(contentRes.body.data).not.toHaveProperty('studentId');

      const submitReviewRes = await request(app)
        .post(`/api/v1/peer/reviews/${reviewId}`)
        .set('Authorization', `Bearer ${student.accessToken}`)
        .send({
          scores: [
            { criterion: 'Correctness', score: 8 },
            { criterion: 'Code Style', score: 9 },
          ],
          feedbackText: 'Good work overall.',
        });
      expect(submitReviewRes.status).toBe(200);
      expect(submitReviewRes.body.data.review.totalScore).toBeCloseTo(84, 0);
    }

    // ننتظر حتى تنتهي مهلة المراجعة
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // UC-PEER-04 — Calculate Final Grades (احتياطي يدوي)
    const gradeRes = await request(app)
      .post(`/api/v1/peer/assignments/${assignmentId}/calculate-grades`)
      .set('Authorization', `Bearer ${instructorToken}`);
    expect(gradeRes.status).toBe(200);
    expect(gradeRes.body.data.assignment.status).toBe('completed');
    expect(gradeRes.body.data.flaggedSubmissionIds.length).toBe(0);

    // كل طالب يرى درجته النهائية
    const firstStudentGrade = await request(app)
      .get(`/api/v1/peer/assignments/${assignmentId}/grades`)
      .set('Authorization', `Bearer ${students[0].accessToken}`);
    expect(firstStudentGrade.status).toBe(200);
    expect(firstStudentGrade.body.data.finalScore).toBeCloseTo(84, 0);
    expect(firstStudentGrade.body.data.reviews[0]).not.toHaveProperty('reviewerId');
  });

  it('rejects distribution with fewer than 3 submissions (400)', async () => {
    const { accessToken: instructorToken, user: instructor } = await createUserAndLogin({
      role: 'Instructor',
      email: 'peer-instructor2@test.local',
    });
    const course = await createCourse(instructor._id);

    const assignment = await PeerAssignment.create({
      courseId: course._id,
      instructorId: instructor._id,
      title: 'Too small',
      rubric: RUBRIC,
      submissionDeadline: new Date(Date.now() - 1000),
      reviewDeadline: new Date(Date.now() + 60000),
    });

    const res = await request(app)
      .post(`/api/v1/peer/assignments/${assignment._id}/distribute`)
      .set('Authorization', `Bearer ${instructorToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INSUFFICIENT_SUBMISSIONS');
  });

  it('rejects a Student trying to create an assignment (403)', async () => {
    const { accessToken: studentToken } = await createUserAndLogin({
      role: 'Student',
      email: 'peer-student-forbidden@test.local',
    });

    const res = await request(app)
      .post('/api/v1/peer/assignments')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        courseId: new mongoose.Types.ObjectId().toString(),
        title: 'Should fail',
        rubric: RUBRIC,
        submissionDeadline: new Date(Date.now() + 60000).toISOString(),
        reviewDeadline: new Date(Date.now() + 120000).toISOString(),
      });

    expect(res.status).toBe(403);
  });
});
