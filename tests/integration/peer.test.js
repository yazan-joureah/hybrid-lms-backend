/**
 * Integration tests — PEER module (UC-PEER-01..04 + مرحلة التسليم)
 * يغطي المسار الأساسي الكامل: إنشاء مهمة → 3 طلاب يسلّمون → توزيع →
 * 3 مراجعات → احتساب الدرجة النهائية، بالإضافة لأهم حالات الرفض.
 *
 * ملاحظة: التوزيع والاحتساب هنا يُستدعيان يدوياً عبر مسارات /distribute
 * و /calculate-grades كاحتياط، لكن في السيناريو الواقعي (كورس async) قد
 * يحدثان تلقائياً بشكل أبكر عبر ensureAssignmentUpToDate بمجرد وصول عدد
 * التسليمات إلى 3، دون انتظار الموعد النهائي.
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
const CourseProgressEvent = require('../../src/models/CourseProgressEvent');
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
    CourseProgressEvent.deleteMany({}),
  ]);
  if (redisClient.status === 'ready') await redisClient.flushdb();
});

afterAll(async () => {
  await mongoose.connection.close();
  if (redisClient.status !== 'end') await redisClient.quit();
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
// NEW — دالة مساعدة كانت مفقودة: تُنشئ N طلاب وتُسجّلهم في الكورس مباشرة
async function enrollStudents(course, count, prefix) {
  const students = [];
  for (let i = 1; i <= count; i += 1) {
    const { accessToken, user } = await createUserAndLogin({
      role: 'Student',
      email: `${prefix}${i}@test.local`,
    });
    await Enrollment.create({
      course_id: course._id,
      student_id: user._id,
      status: 'active',
      confirmed_by_student: true,
    });
    students.push({ accessToken, user });
  }
  return students;
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
    const students = await enrollStudents(course, 3, 'peer-student');

    // NEW — نافذة أوسع بكثير كي تتحمل التراخي الطبيعي لطلبات DB حقيقية متتالية،
    // مع الإبقاء على الاختبار سريعاً نسبياً (لا حاجة لدقائق).
    const submissionDeadline = new Date(Date.now() + 1500);
    const reviewDeadline = new Date(Date.now() + 8000);

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
    expect(createRes.body.data.assignment.allowFileSubmission).toBe(true);
    expect(createRes.body.data.assignment.maxAttempts).toBe(3);
    const assignmentId = createRes.body.data.assignment._id;

    for (const [index, student] of students.entries()) {
      const subRes = await request(app)
        .post(`/api/v1/peer/assignments/${assignmentId}/submit`)
        .set('Authorization', `Bearer ${student.accessToken}`)
        .field('textContent', `My solution number ${index + 1}`);
      expect(subRes.status).toBe(201);
      expect(subRes.body.data.submission.attemptNumber).toBe(1);
    }

    await new Promise((resolve) => setTimeout(resolve, 1600));

    const distributeRes = await request(app)
      .post(`/api/v1/peer/assignments/${assignmentId}/distribute`)
      .set('Authorization', `Bearer ${instructorToken}`);
    expect(distributeRes.status).toBe(200);
    expect(distributeRes.body.data.reviewCount).toBe(3);

    let firstReviewId = null; // NEW — نحتفظ بأول reviewId فقط لاختبار القفل لاحقاً خارج الحلقة

    for (const student of students) {
      const tasksRes = await request(app)
        .get(`/api/v1/peer/assignments/${assignmentId}/my-reviews`)
        .set('Authorization', `Bearer ${student.accessToken}`);
      expect(tasksRes.status).toBe(200);
      expect(tasksRes.body.data.reviews.length).toBe(1);

      const reviewId = tasksRes.body.data.reviews[0].reviewId;
      if (!firstReviewId) firstReviewId = { reviewId, token: student.accessToken };

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

    // NEW — التحقق من قفل "بعد الإرسال" مرة واحدة فقط (على أول مراجعة)، خارج
    // حلقة التصحيح الأساسية، كي لا يتراكم زمن إضافي على كل الطلاب الثلاثة.
    const reAccessRes = await request(app)
      .get(`/api/v1/peer/reviews/${firstReviewId.reviewId}/submission`)
      .set('Authorization', `Bearer ${firstReviewId.token}`);
    expect(reAccessRes.status).toBe(409);
    expect(reAccessRes.body.error.code).toBe('REVIEW_ALREADY_SUBMITTED');

    const reSubmitRes = await request(app)
      .post(`/api/v1/peer/reviews/${firstReviewId.reviewId}`)
      .set('Authorization', `Bearer ${firstReviewId.token}`)
      .send({
        scores: [
          { criterion: 'Correctness', score: 1 },
          { criterion: 'Code Style', score: 1 },
        ],
      });
    expect(reSubmitRes.status).toBe(409);
    expect(reSubmitRes.body.error.code).toBe('REVIEW_ALREADY_SUBMITTED');

    // انتظار مضمون لتجاوز reviewDeadline (8000ms من الإنشاء) قبل التصحيح النهائي
    const msUntilReviewDeadline = reviewDeadline.getTime() - Date.now();
    await new Promise((resolve) => setTimeout(resolve, Math.max(msUntilReviewDeadline + 500, 0)));

    const gradeRes = await request(app)
      .post(`/api/v1/peer/assignments/${assignmentId}/calculate-grades`)
      .set('Authorization', `Bearer ${instructorToken}`);
    expect(gradeRes.status).toBe(200);
    expect(gradeRes.body.data.assignment.status).toBe('completed');
    expect(gradeRes.body.data.flaggedSubmissionIds.length).toBe(0);

    const firstStudentGrade = await request(app)
      .get(`/api/v1/peer/assignments/${assignmentId}/grades`)
      .set('Authorization', `Bearer ${students[0].accessToken}`);
    expect(firstStudentGrade.status).toBe(200);
    expect(firstStudentGrade.body.data.finalScore).toBeCloseTo(84, 0);
    expect(firstStudentGrade.body.data.reviews[0]).not.toHaveProperty('reviewerId');

    const blockedRetryRes = await request(app)
      .post(`/api/v1/peer/assignments/${assignmentId}/submit`)
      .set('Authorization', `Bearer ${students[0].accessToken}`)
      .field('textContent', 'Trying to resubmit after final lock');
    expect(blockedRetryRes.status).toBe(400);
    expect(blockedRetryRes.body.error.code).toBe('SUBMISSIONS_CLOSED');
  }, 20000); // NEW — رفع مهلة الاختبار نفسه كي لا يفشل بـ Jest timeout بسبب الانتظار الأطول
});

describe('PEER — grading.service.js coverage gaps', () => {
  it('rejects calculateFinalGrades for a non-existent assignment (404)', async () => {
    const { accessToken: instructorToken } = await createUserAndLogin({
      role: 'Instructor',
      email: 'grading-404@test.local',
    });
    const fakeId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .post(`/api/v1/peer/assignments/${fakeId}/calculate-grades`)
      .set('Authorization', `Bearer ${instructorToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ASSIGNMENT_NOT_FOUND');
  });

  it('rejects calculateFinalGrades before distribution (NOT_DISTRIBUTED_YET)', async () => {
    const { accessToken: instructorToken, user: instructor } = await createUserAndLogin({
      role: 'Instructor',
      email: 'grading-not-distributed@test.local',
    });
    const course = await createCourse(instructor._id);
    const assignment = await PeerAssignment.create({
      courseId: course._id,
      instructorId: instructor._id,
      title: 'Still open',
      rubric: RUBRIC,
    });

    const res = await request(app)
      .post(`/api/v1/peer/assignments/${assignment._id}/calculate-grades`)
      .set('Authorization', `Bearer ${instructorToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_DISTRIBUTED_YET');
  });
  it('rejects calculateFinalGrades while reviewDeadline has not passed yet (REVIEW_STILL_OPEN)', async () => {
    const { accessToken: instructorToken, user: instructor } = await createUserAndLogin({
      role: 'Instructor',
      email: 'grading-still-open@test.local',
    });
    const course = await createCourse(instructor._id);
    const assignment = await PeerAssignment.create({
      courseId: course._id,
      instructorId: instructor._id,
      title: 'Distributed, deadline in future',
      rubric: RUBRIC,
      status: 'distributed',
      // NEW — submissionDeadline إلزامي حالما نضع reviewDeadline، ويجب أن يسبقه
      submissionDeadline: new Date(Date.now() - 60000),
      reviewDeadline: new Date(Date.now() + 60000),
    });

    const res = await request(app)
      .post(`/api/v1/peer/assignments/${assignment._id}/calculate-grades`)
      .set('Authorization', `Bearer ${instructorToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('REVIEW_STILL_OPEN');
  });

  it('is idempotent when the assignment is already completed', async () => {
    const { accessToken: instructorToken, user: instructor } = await createUserAndLogin({
      role: 'Instructor',
      email: 'grading-already-done@test.local',
    });
    const course = await createCourse(instructor._id);
    const assignment = await PeerAssignment.create({
      courseId: course._id,
      instructorId: instructor._id,
      title: 'Already completed',
      rubric: RUBRIC,
      status: 'completed',
    });

    const res = await request(app)
      .post(`/api/v1/peer/assignments/${assignment._id}/calculate-grades`)
      .set('Authorization', `Bearer ${instructorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.alreadyCompleted).toBe(true);
  });

  it('flags a submission with NO_REVIEWER_COMPLETED and one with REVIEWER_VARIANCE_EXCEEDS_THRESHOLD', async () => {
    const { accessToken: instructorToken, user: instructor } = await createUserAndLogin({
      role: 'Instructor',
      email: 'grading-flags@test.local',
    });
    const course = await createCourse(instructor._id);
    const students = await enrollStudents(course, 4, 'grading-flag-student');

    const assignment = await PeerAssignment.create({
      courseId: course._id,
      instructorId: instructor._id,
      title: 'Variance test',
      rubric: RUBRIC,
      status: 'distributed',
      reviewersPerSubmission: 2,
    });

    // sub A — no completed reviews at all → NO_REVIEWER_COMPLETED
    const subA = await PeerSubmission.create({
      assignmentId: assignment._id,
      studentId: students[0].user._id,
      courseId: course._id,
      textContent: 'A',
      submittedAt: new Date(),
      displaySequentialId: 1,
    });
    await PeerReview.create({
      assignmentId: assignment._id,
      submissionId: subA._id,
      reviewerId: students[1].user._id,
      status: 'assigned',
    });

    // sub B — two completed reviews with huge variance → flagged
    const subB = await PeerSubmission.create({
      assignmentId: assignment._id,
      studentId: students[1].user._id,
      courseId: course._id,
      textContent: 'B',
      submittedAt: new Date(),
      displaySequentialId: 2,
    });
    await PeerReview.create({
      assignmentId: assignment._id,
      submissionId: subB._id,
      reviewerId: students[2].user._id,
      status: 'completed',
      totalScore: 95,
      scores: [{ criterion: 'Correctness', score: 10 }],
    });
    await PeerReview.create({
      assignmentId: assignment._id,
      submissionId: subB._id,
      reviewerId: students[3].user._id,
      status: 'completed',
      totalScore: 40,
      scores: [{ criterion: 'Correctness', score: 4 }],
    });

    const res = await request(app)
      .post(`/api/v1/peer/assignments/${assignment._id}/calculate-grades`)
      .set('Authorization', `Bearer ${instructorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.flaggedSubmissionIds).toEqual(
      expect.arrayContaining([subA._id.toString(), subB._id.toString()])
    );

    const refreshedA = await PeerSubmission.findById(subA._id).lean();
    expect(refreshedA.gradingFlagReason).toBe('NO_REVIEWER_COMPLETED');
    expect(refreshedA.finalScore).toBeNull();

    const refreshedB = await PeerSubmission.findById(subB._id).lean();
    expect(refreshedB.gradingFlagReason).toBe('REVIEWER_VARIANCE_EXCEEDS_THRESHOLD');
    expect(refreshedB.finalScore).toBeCloseTo(67.5, 0);
  });

  it('skips recalculating a gradeOverridden submission during batch grading', async () => {
    const { accessToken: instructorToken, user: instructor } = await createUserAndLogin({
      role: 'Instructor',
      email: 'grading-skip-overridden@test.local',
    });
    const course = await createCourse(instructor._id);
    const students = await enrollStudents(course, 2, 'grading-skip-student');

    const assignment = await PeerAssignment.create({
      courseId: course._id,
      instructorId: instructor._id,
      title: 'Overridden skip test',
      rubric: RUBRIC,
      status: 'distributed',
    });

    const sub = await PeerSubmission.create({
      assignmentId: assignment._id,
      studentId: students[0].user._id,
      courseId: course._id,
      textContent: 'Overridden already',
      submittedAt: new Date(),
      displaySequentialId: 1,
      gradeOverridden: true,
      finalScore: 77,
      finalScorePercentage: 77,
    });
    await PeerReview.create({
      assignmentId: assignment._id,
      submissionId: sub._id,
      reviewerId: students[1].user._id,
      status: 'completed',
      totalScore: 10, // لو أُعيد احتسابها ستتغير — يجب ألا تتغير
      scores: [{ criterion: 'Correctness', score: 1 }],
    });

    await request(app)
      .post(`/api/v1/peer/assignments/${assignment._id}/calculate-grades`)
      .set('Authorization', `Bearer ${instructorToken}`);

    const refreshed = await PeerSubmission.findById(sub._id).lean();
    expect(refreshed.finalScorePercentage).toBe(77); // لم تتغير رغم المراجعة الجديدة
  });

  describe('overrideSubmissionGrade', () => {
    it('rejects an override while assignment is mid-distribution (409)', async () => {
      const { accessToken: instructorToken, user: instructor } = await createUserAndLogin({
        role: 'Instructor',
        email: 'override-distributing@test.local',
      });
      const course = await createCourse(instructor._id);
      const [student] = await enrollStudents(course, 1, 'override-distributing-student');

      const assignment = await PeerAssignment.create({
        courseId: course._id,
        instructorId: instructor._id,
        title: 'Distributing lock',
        rubric: RUBRIC,
        status: 'distributing',
      });
      const sub = await PeerSubmission.create({
        assignmentId: assignment._id,
        studentId: student.user._id,
        courseId: course._id,
        textContent: 'x',
        submittedAt: new Date(),
      });

      const res = await request(app)
        .patch(`/api/v1/peer/assignments/${assignment._id}/submissions/${sub._id}/override-grade`)
        .set('Authorization', `Bearer ${instructorToken}`)
        .send({ finalScorePercentage: 90 });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DISTRIBUTION_IN_PROGRESS');
    });

    it('rejects overriding a submission that does not belong to the assignment (404)', async () => {
      const { accessToken: instructorToken, user: instructor } = await createUserAndLogin({
        role: 'Instructor',
        email: 'override-wrong-sub@test.local',
      });
      const course = await createCourse(instructor._id);
      const assignment = await PeerAssignment.create({
        courseId: course._id,
        instructorId: instructor._id,
        title: 'Wrong sub test',
        rubric: RUBRIC,
        status: 'distributed',
      });
      const fakeSubmissionId = new mongoose.Types.ObjectId().toString();

      const res = await request(app)
        .patch(
          `/api/v1/peer/assignments/${assignment._id}/submissions/${fakeSubmissionId}/override-grade`
        )
        .set('Authorization', `Bearer ${instructorToken}`)
        .send({ finalScorePercentage: 90 });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('SUBMISSION_NOT_FOUND');
    });

    it('rejects an override attempt by an instructor who does not own the course (403 + audit)', async () => {
      const { user: owner } = await createUserAndLogin({
        role: 'Instructor',
        email: 'override-owner@test.local',
      });
      const { accessToken: intruderToken } = await createUserAndLogin({
        role: 'Instructor',
        email: 'override-intruder@test.local',
      });
      const course = await createCourse(owner._id);
      const [student] = await enrollStudents(course, 1, 'override-intruder-student');

      const assignment = await PeerAssignment.create({
        courseId: course._id,
        instructorId: owner._id,
        title: 'IDOR test',
        rubric: RUBRIC,
        status: 'distributed',
      });
      const sub = await PeerSubmission.create({
        assignmentId: assignment._id,
        studentId: student.user._id,
        courseId: course._id,
        textContent: 'x',
        submittedAt: new Date(),
      });

      const res = await request(app)
        .patch(`/api/v1/peer/assignments/${assignment._id}/submissions/${sub._id}/override-grade`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .send({ finalScorePercentage: 90 });

      expect(res.status).toBe(403);
    });

    it('successfully overrides a grade and locks it (gradeOverridden=true)', async () => {
      const { accessToken: instructorToken, user: instructor } = await createUserAndLogin({
        role: 'Instructor',
        email: 'override-success@test.local',
      });
      const course = await createCourse(instructor._id);
      const [student] = await enrollStudents(course, 1, 'override-success-student');

      const assignment = await PeerAssignment.create({
        courseId: course._id,
        instructorId: instructor._id,
        title: 'Override success',
        rubric: RUBRIC,
        status: 'distributed',
      });
      const sub = await PeerSubmission.create({
        assignmentId: assignment._id,
        studentId: student.user._id,
        courseId: course._id,
        textContent: 'x',
        submittedAt: new Date(),
        finalScorePercentage: 40,
      });

      const res = await request(app)
        .patch(`/api/v1/peer/assignments/${assignment._id}/submissions/${sub._id}/override-grade`)
        .set('Authorization', `Bearer ${instructorToken}`)
        .send({ finalScorePercentage: 95, reason: 'Reviewer was unfair' });

      expect(res.status).toBe(200);
      expect(res.body.data.submission.finalScorePercentage).toBe(95);
      expect(res.body.data.submission.gradeOverridden).toBe(true);
      expect(res.body.data.submission.overrideReason).toBe('Reviewer was unfair');
    });
  });

  describe('getGradeSummary', () => {
    it('rejects a student with no submission (404)', async () => {
      const { user: instructor } = await createUserAndLogin({
        role: 'Instructor',
        email: 'grade-summary-nosub@test.local',
      });
      const course = await createCourse(instructor._id);
      const [student] = await enrollStudents(course, 1, 'grade-summary-nosub-student');

      const assignment = await PeerAssignment.create({
        courseId: course._id,
        instructorId: instructor._id,
        title: 'No submission yet',
        rubric: RUBRIC,
      });

      const res = await request(app)
        .get(`/api/v1/peer/assignments/${assignment._id}/grades`)
        .set('Authorization', `Bearer ${student.accessToken}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('SUBMISSION_NOT_FOUND');
    });

    it('rejects an instructor who does not own the assignment (403)', async () => {
      const { user: owner } = await createUserAndLogin({
        role: 'Instructor',
        email: 'grade-summary-owner@test.local',
      });
      const { accessToken: otherToken } = await createUserAndLogin({
        role: 'Instructor',
        email: 'grade-summary-other@test.local',
      });
      const course = await createCourse(owner._id);
      const assignment = await PeerAssignment.create({
        courseId: course._id,
        instructorId: owner._id,
        title: 'Owner only',
        rubric: RUBRIC,
      });

      const res = await request(app)
        .get(`/api/v1/peer/assignments/${assignment._id}/grades`)
        .set('Authorization', `Bearer ${otherToken}`);
      expect(res.status).toBe(403);
    });

    it('rejects fetching grades for a non-existent assignment (404)', async () => {
      const { accessToken: studentToken } = await createUserAndLogin({
        role: 'Student',
        email: 'grade-summary-404@test.local',
      });
      const fakeId = new mongoose.Types.ObjectId().toString();

      const res = await request(app)
        .get(`/api/v1/peer/assignments/${fakeId}/grades`)
        .set('Authorization', `Bearer ${studentToken}`);
      expect(res.status).toBe(404);
    });
  });
});

describe('PEER — review.service.js coverage gaps', () => {
  it('returns 404 for a review task that does not exist', async () => {
    const { accessToken: studentToken } = await createUserAndLogin({
      role: 'Student',
      email: 'review-404@test.local',
    });
    const fakeReviewId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .get(`/api/v1/peer/reviews/${fakeReviewId}/submission`)
      .set('Authorization', `Bearer ${studentToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('REVIEW_NOT_FOUND');
  });

  it('rejects a student trying to access a review task assigned to someone else (403)', async () => {
    const { user: instructor } = await createUserAndLogin({
      role: 'Instructor',
      email: 'review-idor-instructor@test.local',
    });
    const course = await createCourse(instructor._id);
    const students = await enrollStudents(course, 2, 'review-idor-student');

    const assignment = await PeerAssignment.create({
      courseId: course._id,
      instructorId: instructor._id,
      title: 'IDOR review test',
      rubric: RUBRIC,
      status: 'distributed',
    });
    const sub = await PeerSubmission.create({
      assignmentId: assignment._id,
      studentId: students[0].user._id,
      courseId: course._id,
      textContent: 'secret content',
      submittedAt: new Date(),
      displaySequentialId: 1,
    });
    const review = await PeerReview.create({
      assignmentId: assignment._id,
      submissionId: sub._id,
      reviewerId: students[0].user._id, // مخصصة للطالب 0
      status: 'assigned',
    });

    // الطالب 1 (ليس المراجِع المخصَّص) يحاول الوصول
    const res = await request(app)
      .get(`/api/v1/peer/reviews/${review._id}/submission`)
      .set('Authorization', `Bearer ${students[1].accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns NO_FILE_ATTACHED when downloading a text-only submission', async () => {
    const { user: instructor } = await createUserAndLogin({
      role: 'Instructor',
      email: 'review-no-file-instructor@test.local',
    });
    const course = await createCourse(instructor._id);
    const students = await enrollStudents(course, 2, 'review-no-file-student');

    const assignment = await PeerAssignment.create({
      courseId: course._id,
      instructorId: instructor._id,
      title: 'No file test',
      rubric: RUBRIC,
      status: 'distributed',
    });
    const sub = await PeerSubmission.create({
      assignmentId: assignment._id,
      studentId: students[0].user._id,
      courseId: course._id,
      textContent: 'text only, no file',
      submittedAt: new Date(),
      displaySequentialId: 1,
    });
    const review = await PeerReview.create({
      assignmentId: assignment._id,
      submissionId: sub._id,
      reviewerId: students[1].user._id,
      status: 'assigned',
    });

    const res = await request(app)
      .get(`/api/v1/peer/reviews/${review._id}/submission/download`)
      .set('Authorization', `Bearer ${students[1].accessToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NO_FILE_ATTACHED');
  });

  it('rejects submitReview with an incomplete rubric (INCOMPLETE_RUBRIC)', async () => {
    const { user: instructor } = await createUserAndLogin({
      role: 'Instructor',
      email: 'review-incomplete-instructor@test.local',
    });
    const course = await createCourse(instructor._id);
    const students = await enrollStudents(course, 2, 'review-incomplete-student');

    const assignment = await PeerAssignment.create({
      courseId: course._id,
      instructorId: instructor._id,
      title: 'Incomplete rubric test',
      rubric: RUBRIC, // Correctness + Code Style
      status: 'distributed',
    });
    const sub = await PeerSubmission.create({
      assignmentId: assignment._id,
      studentId: students[0].user._id,
      courseId: course._id,
      textContent: 'x',
      submittedAt: new Date(),
      displaySequentialId: 1,
    });
    const review = await PeerReview.create({
      assignmentId: assignment._id,
      submissionId: sub._id,
      reviewerId: students[1].user._id,
      status: 'assigned',
    });

    const res = await request(app)
      .post(`/api/v1/peer/reviews/${review._id}`)
      .set('Authorization', `Bearer ${students[1].accessToken}`)
      .send({ scores: [{ criterion: 'Correctness', score: 5 }] }); // ناقص Code Style

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INCOMPLETE_RUBRIC');
  });
  it('rejects submitReview after the review deadline has passed', async () => {
    const { user: instructor } = await createUserAndLogin({
      role: 'Instructor',
      email: 'review-deadline-instructor@test.local',
    });
    const course = await createCourse(instructor._id);
    const students = await enrollStudents(course, 2, 'review-deadline-student');

    const assignment = await PeerAssignment.create({
      courseId: course._id,
      instructorId: instructor._id,
      title: 'Deadline passed test',
      rubric: RUBRIC,
      status: 'distributed',
      // NEW — يجب أن يسبق reviewDeadline زمنياً، وكلاهما في الماضي هنا لأن الهدف اختبار انقضاء reviewDeadline فقط
      submissionDeadline: new Date(Date.now() - 5000),
      reviewDeadline: new Date(Date.now() - 1000),
    });
    const sub = await PeerSubmission.create({
      assignmentId: assignment._id,
      studentId: students[0].user._id,
      courseId: course._id,
      textContent: 'x',
      submittedAt: new Date(),
      displaySequentialId: 1,
    });
    const review = await PeerReview.create({
      assignmentId: assignment._id,
      submissionId: sub._id,
      reviewerId: students[1].user._id,
      status: 'assigned',
    });

    const res = await request(app)
      .post(`/api/v1/peer/reviews/${review._id}`)
      .set('Authorization', `Bearer ${students[1].accessToken}`)
      .send({
        scores: [
          { criterion: 'Correctness', score: 5 },
          { criterion: 'Code Style', score: 5 },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('REVIEW_DEADLINE_PASSED');
  });

  it('clamps a reviewer score above maxScore instead of exceeding it', async () => {
    const { user: instructor } = await createUserAndLogin({
      role: 'Instructor',
      email: 'review-clamp-instructor@test.local',
    });
    const course = await createCourse(instructor._id);
    const students = await enrollStudents(course, 2, 'review-clamp-student');

    const assignment = await PeerAssignment.create({
      courseId: course._id,
      instructorId: instructor._id,
      title: 'Clamp test',
      rubric: RUBRIC,
      status: 'distributed',
    });
    const sub = await PeerSubmission.create({
      assignmentId: assignment._id,
      studentId: students[0].user._id,
      courseId: course._id,
      textContent: 'x',
      submittedAt: new Date(),
      displaySequentialId: 1,
    });
    const review = await PeerReview.create({
      assignmentId: assignment._id,
      submissionId: sub._id,
      reviewerId: students[1].user._id,
      status: 'assigned',
    });

    const res = await request(app)
      .post(`/api/v1/peer/reviews/${review._id}`)
      .set('Authorization', `Bearer ${students[1].accessToken}`)
      .send({
        scores: [
          { criterion: 'Correctness', score: 999 }, // maxScore=10 → يُقصّ إلى 10
          { criterion: 'Code Style', score: 10 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.review.totalScore).toBe(100);
  });

  describe('listReviewsForInstructor authorization', () => {
    it('rejects a non-owning instructor (403)', async () => {
      const { user: owner } = await createUserAndLogin({
        role: 'Instructor',
        email: 'review-list-owner@test.local',
      });
      const { accessToken: otherToken } = await createUserAndLogin({
        role: 'Instructor',
        email: 'review-list-other@test.local',
      });
      const course = await createCourse(owner._id);
      const assignment = await PeerAssignment.create({
        courseId: course._id,
        instructorId: owner._id,
        title: 'Owner-only listing',
        rubric: RUBRIC,
      });

      const res = await request(app)
        .get(`/api/v1/peer/assignments/${assignment._id}/reviews`)
        .set('Authorization', `Bearer ${otherToken}`);
      expect(res.status).toBe(403);
    });

    it('returns an empty timeline for an assignment with no submissions', async () => {
      const { accessToken: instructorToken, user: instructor } = await createUserAndLogin({
        role: 'Instructor',
        email: 'review-list-empty@test.local',
      });
      const course = await createCourse(instructor._id);
      const assignment = await PeerAssignment.create({
        courseId: course._id,
        instructorId: instructor._id,
        title: 'Empty listing',
        rubric: RUBRIC,
      });

      const res = await request(app)
        .get(`/api/v1/peer/assignments/${assignment._id}/reviews`)
        .set('Authorization', `Bearer ${instructorToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.timeline).toEqual([]);
    });
  });
});

describe('PEER — submission.service.js coverage gaps', () => {
  it('rejects submission from a non-enrolled student (403 + audit)', async () => {
    const { user: instructor } = await createUserAndLogin({
      role: 'Instructor',
      email: 'sub-not-enrolled-instructor@test.local',
    });
    const { accessToken: outsiderToken } = await createUserAndLogin({
      role: 'Student',
      email: 'sub-not-enrolled-outsider@test.local',
    });
    const course = await createCourse(instructor._id);
    const assignment = await PeerAssignment.create({
      courseId: course._id,
      instructorId: instructor._id,
      title: 'Not enrolled test',
      rubric: RUBRIC,
    });

    const res = await request(app)
      .post(`/api/v1/peer/assignments/${assignment._id}/submit`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .field('textContent', 'sneaky');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_ENROLLED');
  });

  it('rejects an empty submission (no text, no file)', async () => {
    const { user: instructor } = await createUserAndLogin({
      role: 'Instructor',
      email: 'sub-empty-instructor@test.local',
    });
    const course = await createCourse(instructor._id);
    const [student] = await enrollStudents(course, 1, 'sub-empty-student');
    const assignment = await PeerAssignment.create({
      courseId: course._id,
      instructorId: instructor._id,
      title: 'Empty submission test',
      rubric: RUBRIC,
    });

    const res = await request(app)
      .post(`/api/v1/peer/assignments/${assignment._id}/submit`)
      .set('Authorization', `Bearer ${student.accessToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EMPTY_SUBMISSION');
  });

  it('rejects submission for a non-existent assignment (404)', async () => {
    const { accessToken: studentToken } = await createUserAndLogin({
      role: 'Student',
      email: 'sub-404@test.local',
    });
    const fakeId = new mongoose.Types.ObjectId().toString();

    const res = await request(app)
      .post(`/api/v1/peer/assignments/${fakeId}/submit`)
      .set('Authorization', `Bearer ${studentToken}`)
      .field('textContent', 'x');
    expect(res.status).toBe(404);
  });

  it('rejects submission once the assignment is fully completed (SUBMISSIONS_CLOSED)', async () => {
    const { user: instructor } = await createUserAndLogin({
      role: 'Instructor',
      email: 'sub-closed-instructor@test.local',
    });
    const course = await createCourse(instructor._id);
    const [student] = await enrollStudents(course, 1, 'sub-closed-student');
    const assignment = await PeerAssignment.create({
      courseId: course._id,
      instructorId: instructor._id,
      title: 'Closed test',
      rubric: RUBRIC,
      status: 'completed',
    });

    const res = await request(app)
      .post(`/api/v1/peer/assignments/${assignment._id}/submit`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .field('textContent', 'too late');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SUBMISSIONS_CLOSED');
  });

  it('rejects a distributed submission for a SYNCHRONOUS course (no late join allowed)', async () => {
    const { user: instructor } = await createUserAndLogin({
      role: 'Instructor',
      email: 'sub-sync-instructor@test.local',
    });
    const course = await Course.create({
      owner_instructor_id: instructor._id,
      title: 'Sync course',
      description: 'x',
      category: 'Technology & Computer Science',
      course_type: 'free',
      is_synchronous: true,
      status: 'published',
    });
    const [student] = await enrollStudents(course, 1, 'sub-sync-student');
    const assignment = await PeerAssignment.create({
      courseId: course._id,
      instructorId: instructor._id,
      title: 'Sync distributed test',
      rubric: RUBRIC,
      status: 'distributed',
    });

    const res = await request(app)
      .post(`/api/v1/peer/assignments/${assignment._id}/submit`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .field('textContent', 'late for sync course');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SUBMISSIONS_CLOSED');
  });

  it('rejects listSubmissionsForInstructor for a non-owning instructor (403)', async () => {
    const { user: owner } = await createUserAndLogin({
      role: 'Instructor',
      email: 'sub-list-owner@test.local',
    });
    const { accessToken: otherToken } = await createUserAndLogin({
      role: 'Instructor',
      email: 'sub-list-other@test.local',
    });
    const course = await createCourse(owner._id);
    const assignment = await PeerAssignment.create({
      courseId: course._id,
      instructorId: owner._id,
      title: 'List forbidden test',
      rubric: RUBRIC,
    });

    const res = await request(app)
      .get(`/api/v1/peer/assignments/${assignment._id}/submissions`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
  });

  it('returns null submission for getMySubmission when the student has not submitted', async () => {
    const { user: instructor } = await createUserAndLogin({
      role: 'Instructor',
      email: 'sub-mysub-instructor@test.local',
    });
    const course = await createCourse(instructor._id);
    const [student] = await enrollStudents(course, 1, 'sub-mysub-student');
    const assignment = await PeerAssignment.create({
      courseId: course._id,
      instructorId: instructor._id,
      title: 'No submission yet',
      rubric: RUBRIC,
    });

    const res = await request(app)
      .get(`/api/v1/peer/assignments/${assignment._id}/my-submission`)
      .set('Authorization', `Bearer ${student.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.submission).toBeNull();
  });
});

describe('PEER — assignment.service.js coverage gaps', () => {
  it('rejects updating an assignment after distribution has started (ASSIGNMENT_LOCKED)', async () => {
    const { accessToken: instructorToken, user: instructor } = await createUserAndLogin({
      role: 'Instructor',
      email: 'assign-locked-instructor@test.local',
    });
    const course = await createCourse(instructor._id);
    const assignment = await PeerAssignment.create({
      courseId: course._id,
      instructorId: instructor._id,
      title: 'Locked test',
      rubric: RUBRIC,
      status: 'distributed',
    });

    const res = await request(app)
      .patch(`/api/v1/peer/assignments/${assignment._id}`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({ title: 'Trying to edit after lock' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ASSIGNMENT_LOCKED');
  });

  it('rejects deleting an assignment that already has submissions', async () => {
    const { accessToken: instructorToken, user: instructor } = await createUserAndLogin({
      role: 'Instructor',
      email: 'assign-delete-instructor@test.local',
    });
    const course = await createCourse(instructor._id);
    const [student] = await enrollStudents(course, 1, 'assign-delete-student');
    const assignment = await PeerAssignment.create({
      courseId: course._id,
      instructorId: instructor._id,
      title: 'Has submissions',
      rubric: RUBRIC,
    });
    await PeerSubmission.create({
      assignmentId: assignment._id,
      studentId: student.user._id,
      courseId: course._id,
      textContent: 'x',
      submittedAt: new Date(),
    });

    const res = await request(app)
      .delete(`/api/v1/peer/assignments/${assignment._id}`)
      .set('Authorization', `Bearer ${instructorToken}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ASSIGNMENT_HAS_SUBMISSIONS');
  });

  it('rejects creating an assignment for a course the instructor does not own', async () => {
    const { user: owner } = await createUserAndLogin({
      role: 'Instructor',
      email: 'assign-create-owner@test.local',
    });
    const { accessToken: intruderToken } = await createUserAndLogin({
      role: 'Instructor',
      email: 'assign-create-intruder@test.local',
    });
    const course = await createCourse(owner._id);

    const res = await request(app)
      .post('/api/v1/peer/assignments')
      .set('Authorization', `Bearer ${intruderToken}`)
      .send({
        courseId: course._id.toString(),
        title: 'Not my course',
        rubric: RUBRIC,
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects creating an assignment with a unit that belongs to a different course', async () => {
    const { accessToken: instructorToken, user: instructor } = await createUserAndLogin({
      role: 'Instructor',
      email: 'assign-wrong-unit@test.local',
    });
    const course = await createCourse(instructor._id);
    const otherCourse = await createCourse(instructor._id);
    const CourseUnit = require('../../src/models/CourseUnit');
    const unit = await CourseUnit.create({
      course_id: otherCourse._id,
      title: 'Unit in another course',
      order: 1,
    });

    const res = await request(app)
      .post('/api/v1/peer/assignments')
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({
        courseId: course._id.toString(),
        unitId: unit._id.toString(),
        title: 'Wrong unit',
        rubric: RUBRIC,
      });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('UNIT_NOT_FOUND');
  });

  it('rejects a Student trying to update or delete an assignment (403)', async () => {
    const { user: instructor } = await createUserAndLogin({
      role: 'Instructor',
      email: 'assign-student-forbidden@test.local',
    });
    const { accessToken: studentToken } = await createUserAndLogin({
      role: 'Student',
      email: 'assign-student-forbidden-student@test.local',
    });
    const course = await createCourse(instructor._id);
    const assignment = await PeerAssignment.create({
      courseId: course._id,
      instructorId: instructor._id,
      title: 'Student forbidden test',
      rubric: RUBRIC,
    });

    const updateRes = await request(app)
      .patch(`/api/v1/peer/assignments/${assignment._id}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ title: 'Nope' });
    expect(updateRes.status).toBe(403);

    const deleteRes = await request(app)
      .delete(`/api/v1/peer/assignments/${assignment._id}`)
      .set('Authorization', `Bearer ${studentToken}`);
    expect(deleteRes.status).toBe(403);
  });
});
