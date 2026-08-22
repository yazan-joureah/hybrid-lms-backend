/**
 * Integration tests — LIVE module (UC-LIVE-01..08) + ATT module (UC-ATT-01/02)
 * يغطي المسار الأساسي الكامل: جدولة → انضمام → دردشة → مغادرة → تقرير حضور،
 * بالإضافة لأهم حالات الرفض (تعارض وقت، طالب غير مسجَّل، دور خاطئ).
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const User = require('../../src/models/User');
const Course = require('../../src/models/Course');
const Session = require('../../src/models/Session');
const Enrollment = require('../../src/models/Enrollment');
const LiveSession = require('../../src/models/liveSession.model');
const Attendance = require('../../src/models/attendance.model');
const LiveChatMessage = require('../../src/models/liveChatMessage.model');
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
    LiveSession.deleteMany({}),
    Attendance.deleteMany({}),
    LiveChatMessage.deleteMany({}),
  ]);
  if (redisClient.isOpen) await redisClient.flushdb();
});

afterAll(async () => {
  await mongoose.connection.close();
  await redisClient.quit();
});

async function createUserAndLogin({ role, email, kyc_status = 'verified', mfa_enabled = true }) {
  const passwordHash = await hashPassword(PLAIN_PASSWORD);
  const user = await User.create({
    full_name: `Test ${role}`,
    email,
    password_hash: passwordHash,
    birth_date: new Date('1995-01-01'),
    role,
    status: 'active',
    email_verified_at: new Date(),
    kyc_status,
    mfa_enabled,
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
    title: 'Test Course',
    description: 'A course used for LIVE integration tests.',
    category: 'Technology & Computer Science',
    course_type: 'free',
    is_synchronous: true,
    status: 'published',
  });
}

describe('LIVE + ATT — full happy path', () => {
  it('schedules, joins, chats, leaves, and reports attendance correctly', async () => {
    const { accessToken: instructorToken, user: instructor } = await createUserAndLogin({
      role: 'Instructor',
      email: 'instructor@test.local',
    });
    const { accessToken: studentToken, user: student } = await createUserAndLogin({
      role: 'Student',
      email: 'student@test.local',
    });

    const course = await createCourse(instructor._id);
    await Enrollment.create({
      course_id: course._id,
      student_id: student._id,
      status: 'active',
      confirmed_by_student: true,
    });

    // UC-LIVE-01 — Create/Schedule Session (يبدأ بعد ثانية واحدة كي يكون
    // "جارياً" فور اكتمال إنشائه في هذا الاختبار)
    const startTime = new Date(Date.now() + 1000);
    const endTime = new Date(Date.now() + 3600 * 1000);

    const createRes = await request(app)
      .post('/api/v1/live/sessions')
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({
        courseId: course._id.toString(),
        title: 'Week 1 — Introduction',
        meetingLink: 'https://meet.jit.si/test-room',
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.session.status).toBe('scheduled');
    const sessionId = createRes.body.data.session._id;

    // ننتظر حتى يدخل وقت الجلسة فعلياً
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // UC-LIVE-03 — Student يرى الجلسة ضمن جدوله
    const scheduleRes = await request(app)
      .get('/api/v1/live/sessions')
      .set('Authorization', `Bearer ${studentToken}`);
    expect(scheduleRes.status).toBe(200);
    expect(scheduleRes.body.data.sessions.map((s) => s._id)).toContain(sessionId);

    // UC-LIVE-04 — Join (+ UC-ATT-01 تلقائياً)
    const joinRes = await request(app)
      .post(`/api/v1/live/sessions/${sessionId}/join`)
      .set('Authorization', `Bearer ${studentToken}`);
    expect(joinRes.status).toBe(200);
    expect(joinRes.body.data.joinToken).toBeDefined();
    expect(joinRes.body.data.waiting).toBe(false);

    const attendanceRecord = await Attendance.findOne({ sessionId, studentId: student._id });
    expect(attendanceRecord).not.toBeNull();
    expect(attendanceRecord.status).toBe('preliminary');

    // UC-LIVE-06 — Chat
    const chatRes = await request(app)
      .post(`/api/v1/live/sessions/${sessionId}/chat`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ messageType: 'text', text: 'مرحباً، هل يمكنني سماعكم بوضوح؟' });
    expect(chatRes.status).toBe(201);

    const historyRes = await request(app)
      .get(`/api/v1/live/sessions/${sessionId}/chat`)
      .set('Authorization', `Bearer ${instructorToken}`);
    expect(historyRes.status).toBe(200);
    expect(historyRes.body.data.messages.length).toBe(1);

    // UC-ATT-01 (leave) — تسجيل وقت المغادرة وحساب المدة
    const leaveRes = await request(app)
      .post(`/api/v1/live/sessions/${sessionId}/leave`)
      .set('Authorization', `Bearer ${studentToken}`);
    expect(leaveRes.status).toBe(200);
    expect(leaveRes.body.data.leftAt).toBeDefined();

    // UC-LIVE-08 — End Session
    const endRes = await request(app)
      .post(`/api/v1/live/sessions/${sessionId}/end`)
      .set('Authorization', `Bearer ${instructorToken}`);
    expect(endRes.status).toBe(200);
    expect(endRes.body.data.session.status).toBe('ended');

    // UC-ATT-02 — تقرير الحضور
    const reportRes = await request(app)
      .get(`/api/v1/attendance/sessions/${sessionId}/report`)
      .set('Authorization', `Bearer ${instructorToken}`);
    expect(reportRes.status).toBe(200);
    expect(reportRes.body.data.records.length).toBe(1);
    expect(reportRes.body.data.records[0].studentId._id.toString()).toBe(student._id.toString());
  });

  it('rejects join for a student not enrolled in the course (403)', async () => {
    const { user: instructor } = await createUserAndLogin({
      role: 'Instructor',
      email: 'instructor2@test.local',
    });
    const { accessToken: outsiderToken } = await createUserAndLogin({
      role: 'Student',
      email: 'outsider@test.local',
    });

    const course = await createCourse(instructor._id);
    const startTime = new Date(Date.now() - 1000); // بدأت بالفعل
    const endTime = new Date(Date.now() + 3600 * 1000);
    const session = await LiveSession.create({
      courseId: course._id,
      instructorId: instructor._id,
      title: 'Session',
      meetingLink: 'https://meet.jit.si/x',
      startTime,
      endTime,
      status: 'ongoing',
    });

    const res = await request(app)
      .post(`/api/v1/live/sessions/${session._id}/join`)
      .set('Authorization', `Bearer ${outsiderToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_ENROLLED');
  });

  it('rejects overlapping session creation without confirmConflict (409)', async () => {
    const { accessToken: instructorToken, user: instructor } = await createUserAndLogin({
      role: 'Instructor',
      email: 'instructor3@test.local',
    });
    const course = await createCourse(instructor._id);

    const startTime = new Date(Date.now() + 60 * 60 * 1000);
    const endTime = new Date(Date.now() + 2 * 60 * 60 * 1000);

    await LiveSession.create({
      courseId: course._id,
      instructorId: instructor._id,
      title: 'Existing session',
      meetingLink: 'https://meet.jit.si/existing',
      startTime,
      endTime,
      status: 'scheduled',
    });

    const res = await request(app)
      .post('/api/v1/live/sessions')
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({
        courseId: course._id.toString(),
        title: 'Conflicting session',
        meetingLink: 'https://meet.jit.si/conflict',
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SESSION_TIME_CONFLICT');
  });

  it('rejects a Student trying to create a session (403)', async () => {
    const { accessToken: studentToken } = await createUserAndLogin({
      role: 'Student',
      email: 'student4@test.local',
    });

    const res = await request(app)
      .post('/api/v1/live/sessions')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        courseId: new mongoose.Types.ObjectId().toString(),
        title: 'Should fail',
        meetingLink: 'https://meet.jit.si/fail',
        startTime: new Date(Date.now() + 3600 * 1000).toISOString(),
        endTime: new Date(Date.now() + 7200 * 1000).toISOString(),
      });

    expect(res.status).toBe(403);
  });
});
