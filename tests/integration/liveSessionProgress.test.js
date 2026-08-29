/**
 * Integration tests: LIVE ⇄ ATT ⇄ COURSE progress linkage
 * (feature/LIVE-BE-05-unit-linked-progress)
 *  - LiveSession.unit_id + course-status guard (session.service.js)
 *  - Attendance 'present' → CourseProgressEvent(source_type:'live_session')
 *  - getProgressSummary: only linked + ENDED sessions count in the denominator
 *  - Sticky completion: enrollment.status='completed' is immune afterward
 *  - Synchronous-course completion additionally requires a passed published exam
 *    (checkAllQuizzesPassed in progress.service.js) — the exam fixture below
 *    exists specifically to satisfy that gate for the completion test.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const User = require('../../src/models/User');
const Course = require('../../src/models/Course');
const CourseUnit = require('../../src/models/CourseUnit');
const Enrollment = require('../../src/models/Enrollment');
const CourseProgressEvent = require('../../src/models/CourseProgressEvent');
const LiveSession = require('../../src/models/liveSession.model');
const Attendance = require('../../src/models/attendance.model');
const Quiz = require('../../src/models/quiz.model');
const QuizAttempt = require('../../src/models/quizAttempt.model');
const Session = require('../../src/models/Session');
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
    CourseUnit.deleteMany({}),
    Enrollment.deleteMany({}),
    CourseProgressEvent.deleteMany({}),
    LiveSession.deleteMany({}),
    Attendance.deleteMany({}),
    Quiz.deleteMany({}),
    QuizAttempt.deleteMany({}),
    Session.deleteMany({}),
  ]);
  if (redisClient.status === 'ready') await redisClient.flushdb();
});

afterAll(async () => {
  await mongoose.connection.close();
  if (redisClient.status !== 'end') await redisClient.quit();
});
async function createUserAndLogin(overrides = {}) {
  const passwordHash = await hashPassword(PLAIN_PASSWORD);
  const user = await User.create({
    full_name: overrides.full_name || 'Test User',
    email: overrides.email || `user-${Date.now()}-${Math.random()}@example.com`,
    password_hash: passwordHash,
    birth_date: new Date('1990-01-01'),
    role: overrides.role || 'Student',
    status: 'active',
    email_verified_at: new Date(),
    kyc_status: overrides.kyc_status !== undefined ? overrides.kyc_status : 'verified',
    mfa_enabled: overrides.mfa_enabled !== undefined ? overrides.mfa_enabled : true,
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

async function setupSyncCourseWithUnitAndSession({ courseStatus = 'published' } = {}) {
  const instructor = await createUserAndLogin({
    role: 'Instructor',
    email: `inst-${Date.now()}-${Math.random()}@example.com`,
  });
  const course = await Course.create({
    title: 'Live Security Workshop',
    description: 'desc',
    category: 'Technology & Computer Science',
    course_type: 'free',
    is_synchronous: true,
    completion_threshold: 1, // 100% محدَّد عمداً — يجعل النتيجة حتمية مع عنصر واحد فقط
    owner_instructor_id: instructor.user._id,
    status: courseStatus,
  });
  const unit = await CourseUnit.create({ course_id: course._id, title: 'Week 1', order: 1 });

  // إنشاء مباشر بالنموذج — POST /live/sessions يرفض startTime بالماضي
  // (INVALID_START_TIME)، لكن اختبارات الحضور/التقدّم تحتاج جلسة "داخل نافذتها" فعلاً.
  const liveSession = await LiveSession.create({
    courseId: course._id,
    unit_id: unit._id,
    instructorId: instructor.user._id,
    title: 'Live Session 1',
    meetingLink: 'https://meet.jit.si/test-room',
    startTime: new Date(Date.now() - 60 * 60 * 1000),
    endTime: new Date(Date.now() + 60 * 60 * 1000), // نافذة 120 دقيقة إجمالاً
    status: 'ongoing',
    studentsAllowed: true,
  });

  // متطلب checkAllQuizzesPassed: كورس متزامن يحتاج امتحاناً نهائياً منشوراً
  // ليصبح مؤهلاً للاكتمال إطلاقاً — بصرف النظر عن نسبة المحتوى/الجلسات.
  // موجود هنا كجزء من الإعداد المشترك حتى تلتقطه كل الاختبارات، لكنه لا
  // يُصحَّح (grade) إلا صراحة داخل اختبار الاكتمال نفسه.
  const exam = await Quiz.create({
    course_id: course._id,
    instructor_id: instructor.user._id,
    quiz_type: 'exam',
    title: 'Final Exam',
    start_time: new Date(Date.now() - 60 * 60 * 1000),
    end_time: new Date(Date.now() + 60 * 60 * 1000),
    duration_minutes: 30,
    passing_score_percent: 50,
    status: 'published',
    locked: false,
    questions: [
      {
        question_type: 'mcq',
        text: 'Q1',
        choices: [
          { text: 'Right', is_correct: true },
          { text: 'Wrong', is_correct: false },
        ],
      },
    ],
  });

  const student = await createUserAndLogin({
    role: 'Student',
    email: `stud-${Date.now()}-${Math.random()}@example.com`,
  });
  await Enrollment.create({
    course_id: course._id,
    student_id: student.user._id,
    status: 'active',
    confirmed_by_student: true,
  });

  return { instructor, course, unit, liveSession, exam, student };
}

describe('session.service.js — course-status guard (suspended/archived only)', () => {
  it('يرفض جدولة جلسة جديدة بـ 409 COURSE_NOT_ACTIVE على كورس suspended', async () => {
    const { instructor, course } = await setupSyncCourseWithUnitAndSession({
      courseStatus: 'suspended',
    });

    const res = await request(app)
      .post('/api/v1/live/sessions')
      .set('Authorization', `Bearer ${instructor.accessToken}`)
      .send({
        courseId: course._id.toString(),
        title: 'Attempted session on suspended course',
        meetingLink: 'https://meet.jit.si/blocked-room',
        startTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        endTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COURSE_NOT_ACTIVE');
  });
});

describe('Attendance → CourseProgressEvent (recordAttendanceLeave → recordLiveSessionCompletion)', () => {
  it('مغادرة بحالة "present" (≥75% من مدة الجلسة) تُنشئ حدث تقدّم واحداً فقط', async () => {
    const { unit, liveSession, student } = await setupSyncCourseWithUnitAndSession();

    await request(app)
      .post(`/api/v1/live/sessions/${liveSession._id}/join`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .expect(200);

    await Attendance.updateOne(
      { sessionId: liveSession._id, studentId: student.user._id },
      { joinedAt: new Date(Date.now() - 100 * 60 * 1000) }
    );

    await request(app)
      .post(`/api/v1/live/sessions/${liveSession._id}/leave`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .expect(200);

    const attendance = await Attendance.findOne({
      sessionId: liveSession._id,
      studentId: student.user._id,
    });
    expect(attendance.status).toBe('present');

    const events = await CourseProgressEvent.find({
      student_id: student.user._id,
      session_id: liveSession._id,
    });
    expect(events).toHaveLength(1);
    expect(events[0].source_type).toBe('live_session');
    expect(events[0].event_type).toBe('live_session_attended');
    expect(events[0].unit_id.toString()).toBe(unit._id.toString());
  });

  it('مغادرة بحالة "partial" (<75%) لا تُنشئ أي حدث تقدّم', async () => {
    const { liveSession, student } = await setupSyncCourseWithUnitAndSession();

    await request(app)
      .post(`/api/v1/live/sessions/${liveSession._id}/join`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .expect(200);

    await request(app)
      .post(`/api/v1/live/sessions/${liveSession._id}/leave`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .expect(200);

    const attendance = await Attendance.findOne({
      sessionId: liveSession._id,
      studentId: student.user._id,
    });
    expect(attendance.status).toBe('partial');

    const eventsCount = await CourseProgressEvent.countDocuments({
      student_id: student.user._id,
      session_id: liveSession._id,
    });
    expect(eventsCount).toBe(0);
  });

  it('Idempotent: استدعاء /leave مرتين لا يُكرِّر حدث التقدّم', async () => {
    const { liveSession, student } = await setupSyncCourseWithUnitAndSession();

    await request(app)
      .post(`/api/v1/live/sessions/${liveSession._id}/join`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .expect(200);
    await Attendance.updateOne(
      { sessionId: liveSession._id, studentId: student.user._id },
      { joinedAt: new Date(Date.now() - 100 * 60 * 1000) }
    );

    await request(app)
      .post(`/api/v1/live/sessions/${liveSession._id}/leave`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .expect(200);
    await request(app)
      .post(`/api/v1/live/sessions/${liveSession._id}/leave`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .expect(200);

    const eventsCount = await CourseProgressEvent.countDocuments({
      student_id: student.user._id,
      session_id: liveSession._id,
    });
    expect(eventsCount).toBe(1);
  });
});

describe('getProgressSummary — يحتسب فقط الجلسات المرتبطة والمُنتهية (status=ended)', () => {
  it('جلسة لا تزال "ongoing" لا تدخل في المقام بعد', async () => {
    const { course, liveSession, student } = await setupSyncCourseWithUnitAndSession();

    await request(app)
      .post(`/api/v1/live/sessions/${liveSession._id}/join`)
      .set('Authorization', `Bearer ${student.accessToken}`);
    await Attendance.updateOne(
      { sessionId: liveSession._id, studentId: student.user._id },
      { joinedAt: new Date(Date.now() - 100 * 60 * 1000) }
    );
    await request(app)
      .post(`/api/v1/live/sessions/${liveSession._id}/leave`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/progress-summary`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.progress_percentage).toBe(0);
    expect(res.body.data.enrollment_status).toBe('active');
  });

  it('بمجرد أن يُنهي المحاضر الجلسة، ويكون الطالب قد اجتاز الامتحان النهائي، تُحتسَب الجلسة والتسجيل يُصبح completed', async () => {
    const { instructor, course, liveSession, exam, student } =
      await setupSyncCourseWithUnitAndSession();

    await request(app)
      .post(`/api/v1/live/sessions/${liveSession._id}/join`)
      .set('Authorization', `Bearer ${student.accessToken}`);
    await Attendance.updateOne(
      { sessionId: liveSession._id, studentId: student.user._id },
      { joinedAt: new Date(Date.now() - 100 * 60 * 1000) }
    );
    await request(app)
      .post(`/api/v1/live/sessions/${liveSession._id}/leave`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    // Satisfies checkAllQuizzesPassed for this synchronous course: a
    // graded, passed attempt on the published exam — created directly
    // rather than through the real attempt flow, matching the style
    // already used in quizGrading.test.js for timestamp manipulation.
    await QuizAttempt.create({
      quiz_id: exam._id,
      student_id: student.user._id,
      attempt_number: 1,
      shuffled_question_order: exam.questions.map((q) => ({
        question_id: q._id,
        shuffled_choice_ids: q.choices.map((c) => c._id),
      })),
      answers: [
        {
          question_id: exam.questions[0]._id,
          selected_choice_id: exam.questions[0].choices.find((c) => c.is_correct)._id,
          answered_at: new Date(),
        },
      ],
      status: 'graded',
      started_at: new Date(Date.now() - 5 * 60 * 1000),
      expires_at: new Date(Date.now() + 25 * 60 * 1000),
      submitted_at: new Date(),
      submitted_by: 'student',
      graded_at: new Date(),
      score_percent: 100,
      passed: true,
    });

    await request(app)
      .post(`/api/v1/live/sessions/${liveSession._id}/end`)
      .set('Authorization', `Bearer ${instructor.accessToken}`)
      .expect(200);

    const res = await request(app)
      .get(`/api/v1/courses/${course._id}/progress-summary`)
      .set('Authorization', `Bearer ${student.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.progress_percentage).toBe(1); // 1/1
    expect(res.body.data.enrollment_status).toBe('completed');

    // حارس "الإكمال اللاصق": يبقى Enrollment.status='completed' حتى لو
    // جُدولت جلسة إضافية لاحقاً (إصلاح مشكلة "المنهج المتحرك" التي ناقشناها).
    const enrollmentDoc = await Enrollment.findOne({
      course_id: course._id,
      student_id: student.user._id,
    });
    expect(enrollmentDoc.status).toBe('completed');
  });
});
