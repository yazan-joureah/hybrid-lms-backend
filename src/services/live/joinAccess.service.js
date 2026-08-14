// src/services/live/joinAccess.service.js
// SF-LIVE-01 (Validate Session Access & Generate Join Token) | UC-LIVE-04 (Join)
// كما يوفّر leaveLiveSession التي تُغذّي UC-ATT-01 (Auto-Record Attendance) بوقت المغادرة.

const LiveSession = require('../../models/liveSession.model');
const Enrollment = require('../../models/Enrollment');
const { AppError } = require('../../middleware/errorHandler');
const { signJoinToken } = require('../../utils/joinToken.util');
const { toObjectId } = require('../../utils/objectId.util');
const auditService = require('../auditService');
const {
  recordAttendanceAutomatically,
  recordAttendanceLeave,
} = require('../attendance/tracking.service');

/**
 * التحقق من تسجيل الطالب بالكورس عبر نموذج Enrollment (status: 'active' حصراً).
 */
async function isStudentEnrolledInCourse({ studentId, courseId }) {
  const enrollment = await Enrollment.findOne({
    student_id: studentId,
    course_id: courseId,
    status: 'active',
  }).lean();
  return Boolean(enrollment);
}

/**
 * SF-LIVE-01 — Validate Session Access & Generate Join Token
 */
async function validateSessionAccessAndGenerateJoinToken({ studentId, sessionId, req }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeSessionId = toObjectId(sessionId, 'sessionId');

  const session = await LiveSession.findById(safeSessionId).lean();
  if (!session) {
    throw new AppError(404, 'SESSION_NOT_FOUND', 'الجلسة غير موجودة.');
  }

  if (session.status === 'cancelled') {
    throw new AppError(400, 'SESSION_CANCELLED', 'أُلغيت هذه الجلسة.');
  }
  if (session.status === 'ended') {
    throw new AppError(400, 'SESSION_ENDED', 'انتهت هذه الجلسة.');
  }

  const now = new Date();
  if (now < session.startTime) {
    throw new AppError(400, 'SESSION_NOT_STARTED', 'لم تبدأ الجلسة بعد.');
  }
  if (now > session.endTime) {
    throw new AppError(400, 'SESSION_ENDED', 'انتهت هذه الجلسة.');
  }

  const enrolled = await isStudentEnrolledInCourse({
    studentId: safeStudentId,
    courseId: session.courseId,
  });
  if (!enrolled) {
    await auditService.record({
      actorId: safeStudentId,
      actorRole: 'Student',
      action: 'LIVE_JOIN_UNAUTHORIZED_ATTEMPT',
      resourceType: 'LiveSession',
      resourceId: safeSessionId.toString(),
      metadata: { courseId: session.courseId },
      req,
    });
    throw new AppError(403, 'NOT_ENROLLED', 'غير مسجل في هذا الكورس.');
  }

  // ملاحظة: لا يوجد بعد الآن فرع "غرفة انتظار" على مستوى الـ LMS — إن أراد
  // المحاضر تفعيل الانتظار/الموافقة اليدوية على الدخول، يفعّلها هو مباشرة
  // من داخل واجهة Jitsi نفسها (Lobby مجانية بالكامل على meet.jit.si).
  // التحقق الحقيقي من الصلاحية يبقى هنا: تسجيل فعلي + اسم غرفة غير قابل للتخمين.

  const joinToken = signJoinToken({
    studentId: safeStudentId,
    sessionId: session._id,
    courseId: session.courseId,
  });

  return {
    success: true,
    data: {
      waiting: false,
      joinToken,
      meetingLink: session.meetingLink,
      courseId: session.courseId,
    },
  };
}

/**
 * UC-LIVE-04 — Join Live Session (الأوركستريشن الكامل)
 */
async function joinLiveSession({ studentId, sessionId, req }) {
  const accessResult = await validateSessionAccessAndGenerateJoinToken({
    studentId,
    sessionId,
    req,
  });

  // إن كان الطالب لا يزال في غرفة الانتظار، لا يوجد شيء لتتبعه كحضور بعد
  if (accessResult.data.waiting) {
    return accessResult;
  }

  // include UC-ATT-01 — غير حرج: فشل تسجيل الحضور لا يوقف الانضمام
  try {
    await recordAttendanceAutomatically({
      studentId,
      sessionId,
      courseId: accessResult.data.courseId,
    });
  } catch (err) {
    // يُسجَّل الخطأ فقط ولا يُرمى — الانضمام تحقق فعلياً بالفعل
    // eslint-disable-next-line no-console -- تُستبدل بـ logger.js عند دمج نهائي؛ محتفظ بها بسيطة هنا عمداً
    console.error('ATT-01 recording failed (non-critical):', err.message);
  }

  await auditService.record({
    actorId: studentId,
    actorRole: 'Student',
    action: 'LIVE_SESSION_JOINED',
    resourceType: 'LiveSession',
    resourceId: String(sessionId),
    metadata: {},
    req,
  });

  return accessResult;
}

/**
 * دعم UC-ATT-01 (خطوة "وقت الخروج") — REST endpoint صريح يستدعيه العميل عند
 * مغادرة الطالب صفحة البث (أوثق من الاعتماد فقط على قطع اتصال Socket.IO،
 * وتُبقيه هذه كطبقة تكميلية أفضل جهد — راجع src/sockets/liveSocket.js).
 */
async function leaveLiveSession({ userId, role, sessionId, req }) {
  const safeSessionId = toObjectId(sessionId, 'sessionId');
  const safeUserId = toObjectId(userId, 'userId');

  const session = await LiveSession.findById(safeSessionId);
  if (!session) {
    throw new AppError(404, 'SESSION_NOT_FOUND', 'الجلسة غير موجودة.');
  }

  let durationSeconds = null;

  // 1. إذا كان طالباً: نسجل وقت حضوره ونتأكد من اشتراكه
  if (role === 'Student') {
    const enrolled = await isStudentEnrolledInCourse({
      studentId: safeUserId,
      courseId: session.courseId,
    });
    if (!enrolled) throw new AppError(403, 'NOT_ENROLLED', 'غير مسجل في الكورس.');

    const result = await recordAttendanceLeave({ studentId: safeUserId, sessionId: safeSessionId });
    durationSeconds = result.data?.durationSeconds;
  }
  // 2. إذا كان محاضراً: نتأكد فقط من ملكيته للجلسة
  else if (role === 'Instructor') {
    if (session.instructorId.toString() !== safeUserId.toString()) {
      throw new AppError(403, 'FORBIDDEN', 'لا تملك صلاحية هذه الجلسة.');
    }
  }

  // 3. تسجيل الحدث في الـ Audit لكلا الطرفين
  await auditService.record({
    actorId: safeUserId,
    actorRole: role,
    action: 'LIVE_SESSION_LEFT',
    resourceType: 'LiveSession',
    resourceId: String(safeSessionId),
    metadata: { durationSeconds },
    req,
  });

  return { success: true, data: { sessionId: session._id, durationSeconds } };
}

module.exports = {
  validateSessionAccessAndGenerateJoinToken,
  joinLiveSession,
  leaveLiveSession,
  isStudentEnrolledInCourse,
};
