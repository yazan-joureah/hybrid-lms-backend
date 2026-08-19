// tests/integration/certQuizEligibility.test.js
// UC-QUIZ-05 (Link Exam Result to Certificate Eligibility) — the full
// wire-up from gradeAttempt() through checkCertificateEligibilityAfterGrading()
// to issueCertificate(), including the non-duplication and identity-gate
// notification paths.

require('../helpers/setupCertSigningKeys');

const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../../src/models/User');
const Course = require('../../src/models/Course');
const CourseUnit = require('../../src/models/CourseUnit');
const CourseContent = require('../../src/models/CourseContent');
const Enrollment = require('../../src/models/Enrollment');
const Quiz = require('../../src/models/quiz.model');
const QuizAttempt = require('../../src/models/quizAttempt.model');
const Certificate = require('../../src/models/certificate.model');
const CourseProgressEvent = require('../../src/models/CourseProgressEvent');
const AuditLog = require('../../src/models/AuditLog');
const { gradeAttempt } = require('../../src/services/quiz/quizSession.service');

const fakeReq = { ip: '127.0.0.1', get: () => 'jest-test-agent' };

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    const baseUri =
      process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/hybrid_lms';
    const testUri = baseUri.endsWith('_test') ? baseUri : `${baseUri}_test`;
    await mongoose.connect(testUri);
  }
}, 20000);

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Course.deleteMany({}),
    CourseUnit.deleteMany({}),
    CourseContent.deleteMany({}),
    Enrollment.deleteMany({}),
    Quiz.deleteMany({}),
    QuizAttempt.deleteMany({}),
    Certificate.deleteMany({}),
    CourseProgressEvent.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);
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
    kyc_status: 'not_submitted',
    mfa_enabled: false,
    ...overrides,
  });
}

/**
 * Builds a fully self-contained "one question, exam-type, unit-less"
 * course setup where a single graded attempt is BOTH the last quiz AND
 * (once graded) enough to satisfy 100% content completion — keeps this
 * file focused on the CERT wiring, not on exhaustively re-testing
 * progress.service.js's own percentage math (covered elsewhere).
 */
async function setupCourseWithSingleExam(instructorId) {
  const course = await Course.create({
    owner_instructor_id: instructorId,
    title: 'Cert Eligibility Course',
    description: 'desc',
    category: 'Technology & Computer Science',
    course_type: 'free',
    status: 'published',
    completion_threshold: 0, // no content required — isolates the quiz-passing condition
  });

  const exam = await Quiz.create({
    course_id: course._id,
    unit_id: null,
    instructor_id: instructorId,
    quiz_type: 'exam',
    title: 'Final Exam',
    duration_minutes: 30,
    passing_score_percent: 50,
    max_attempts: 1,
    status: 'published',
    locked: true,
    start_time: new Date(Date.now() - 60_000),
    end_time: new Date(Date.now() + 60_000),
    questions: [
      {
        question_type: 'true_false',
        text: 'Is this correct?',
        choices: [
          { text: 'True', is_correct: true },
          { text: 'False', is_correct: false },
        ],
      },
    ],
  });

  return { course, exam };
}

async function createGradedAttempt({ student, course, exam, passed }) {
  await Enrollment.create({
    course_id: course._id,
    student_id: student._id,
    status: 'active',
    confirmed_by_student: true,
  });

  const correctChoiceId = exam.questions[0].choices.find((c) => c.is_correct)._id;
  const wrongChoiceId = exam.questions[0].choices.find((c) => !c.is_correct)._id;

  const attempt = await QuizAttempt.create({
    quiz_id: exam._id,
    student_id: student._id,
    attempt_number: 1,
    shuffled_question_order: [
      {
        question_id: exam.questions[0]._id,
        shuffled_choice_ids: exam.questions[0].choices.map((c) => c._id),
      },
    ],
    answers: [
      {
        question_id: exam.questions[0]._id,
        selected_choice_id: passed ? correctChoiceId : wrongChoiceId,
      },
    ],
    status: 'submitted',
    expires_at: new Date(Date.now() + 60_000),
    submitted_at: new Date(),
    submitted_by: 'student',
  });

  return attempt;
}

describe('UC-QUIZ-05 — checkCertificateEligibilityAfterGrading via gradeAttempt', () => {
  it('issues a certificate automatically when passing the final exam completes ALL requirements + identity is verified', async () => {
    const instructor = await createUser({
      role: 'Instructor',
      kyc_status: 'verified',
      mfa_enabled: true,
    });
    const student = await createUser({ kyc_status: 'verified', mfa_enabled: true });
    const { course, exam } = await setupCourseWithSingleExam(instructor._id);
    const attempt = await createGradedAttempt({ student, course, exam, passed: true });

    await gradeAttempt({ attempt, req: fakeReq });

    const cert = await Certificate.findOne({ student_id: student._id, course_id: course._id });
    expect(cert).not.toBeNull();
    expect(cert.status).toBe('active');

    const enrollment = await Enrollment.findOne({ student_id: student._id, course_id: course._id });
    expect(enrollment.status).toBe('completed');
  });

  it('does NOT issue a certificate when the exam is failed, even with identity verified', async () => {
    const instructor = await createUser({
      role: 'Instructor',
      kyc_status: 'verified',
      mfa_enabled: true,
    });
    const student = await createUser({ kyc_status: 'verified', mfa_enabled: true });
    const { course, exam } = await setupCourseWithSingleExam(instructor._id);
    const attempt = await createGradedAttempt({ student, course, exam, passed: false });

    await gradeAttempt({ attempt, req: fakeReq });

    const cert = await Certificate.findOne({ student_id: student._id, course_id: course._id });
    expect(cert).toBeNull();

    const enrollment = await Enrollment.findOne({ student_id: student._id, course_id: course._id });
    expect(enrollment.status).toBe('active'); // still not completed
  });

  it('does NOT issue a certificate when exam passed but KYC/MFA are missing — grading itself still succeeds', async () => {
    const instructor = await createUser({
      role: 'Instructor',
      kyc_status: 'verified',
      mfa_enabled: true,
    });
    const student = await createUser({ kyc_status: 'not_submitted', mfa_enabled: false });
    const { course, exam } = await setupCourseWithSingleExam(instructor._id);
    const attempt = await createGradedAttempt({ student, course, exam, passed: true });

    const gradeResult = await gradeAttempt({ attempt, req: fakeReq });

    // Grading succeeds and is unaffected by the identity gate.
    expect(gradeResult.success).toBe(true);
    expect(gradeResult.data.passed).toBe(true);

    const cert = await Certificate.findOne({ student_id: student._id, course_id: course._id });
    expect(cert).toBeNull();

    // The enrollment DID reach 'completed' (all course conditions met) —
    // only the certificate itself is withheld pending identity verification.
    const enrollment = await Enrollment.findOne({ student_id: student._id, course_id: course._id });
    expect(enrollment.status).toBe('completed');

    const blockedAuditEntry = await AuditLog.findOne({
      action: 'CERTIFICATE_ISSUANCE_BLOCKED_IDENTITY_NOT_VERIFIED',
    });
    expect(blockedAuditEntry).not.toBeNull();
    expect(blockedAuditEntry.metadata.error_code).toBe('KYC_NOT_VERIFIED');
  });

  it('never issues a DUPLICATE certificate if eligibility check somehow runs twice', async () => {
    const instructor = await createUser({
      role: 'Instructor',
      kyc_status: 'verified',
      mfa_enabled: true,
    });
    const student = await createUser({ kyc_status: 'verified', mfa_enabled: true });
    const { course, exam } = await setupCourseWithSingleExam(instructor._id);
    const attempt = await createGradedAttempt({ student, course, exam, passed: true });

    await gradeAttempt({ attempt, req: fakeReq });

    const {
      checkCertificateEligibilityAfterGrading,
    } = require('../../src/services/cert/certificateEligibility.service');
    // Re-run the eligibility check directly a second time (simulates a
    // retry/race) — must be a no-op, not a second Certificate.
    await checkCertificateEligibilityAfterGrading({ attempt, req: fakeReq });

    const certs = await Certificate.find({ student_id: student._id, course_id: course._id });
    expect(certs).toHaveLength(1);
  });
});
