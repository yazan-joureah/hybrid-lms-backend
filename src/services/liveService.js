/* ==========================================================================
   src/services/liveService.js
   ========================================================================== */

const mongoose = require('mongoose');
// الاستيرادات المعرفّة في تعليماتك
const { AppError } = require('../middleware/errorHandler');
const { signJoinToken } = require('../utils/joinToken.util');
const { recordAttendanceAutomatically } = require('./attendanceService');

// استيراد النماذج
const LiveSession = require('../models/liveSession.model');
const Enrollment = require('../models/Enrollment');

/**
 * دالة مساعدة لاستخراج ID نظيف على شكل String
 */
function extractCleanId(idVal) {
  if (!idVal) return null;
  if (typeof idVal === 'string') return idVal.trim();
  if (idVal.$oid) return String(idVal.$oid).trim();
  if (idVal._id) return extractCleanId(idVal._id);
  return String(idVal).trim();
}

/**
 * التحقق من تسجيل الطالب بالكورس عبر نموذج Enrollment
 */
async function isStudentEnrolledInCourse({ studentId, courseId }) {
  if (!studentId || !courseId) return false;

  const cleanStudentId = extractCleanId(studentId);
  const cleanCourseId = extractCleanId(courseId);

  // تحضير الـ ObjectId في حال كانت القيم صالحة
  const studentObj = mongoose.Types.ObjectId.isValid(cleanStudentId)
    ? new mongoose.Types.ObjectId(cleanStudentId)
    : cleanStudentId;

  const courseObj = mongoose.Types.ObjectId.isValid(cleanCourseId)
    ? new mongoose.Types.ObjectId(cleanCourseId)
    : cleanCourseId;

  // الاستعلام عن التسجيل
  const enrollment = await Enrollment.collection.findOne({
    $or: [
      { student_id: cleanStudentId, course_id: cleanCourseId },
      { student_id: studentObj, course_id: courseObj },
      { student_id: cleanStudentId, course_id: courseObj },
      { student_id: studentObj, course_id: cleanCourseId },
      { studentId: cleanStudentId, courseId: cleanCourseId },
      { studentId: studentObj, courseId: courseObj },
    ],
    status: 'active',
  });

  return Boolean(enrollment);
}

/**
 * UC-LIVE-01 (Join Live Session) + SF-LIVE-01
 */
async function joinLiveSession({ studentId, sessionId, _req }) {
  // 1. البحث عن الجلسة المباشرة
  const session = await LiveSession.findById(sessionId).lean();
  if (!session) {
    throw new AppError('الجلسة المباشرة غير موجودة', 404, 'SESSION_NOT_FOUND');
  }

  // استخراج معرّف الكورس بأمان
  const rawCourseId = session.course_id || session.courseId;
  const targetCourseId = extractCleanId(rawCourseId);

  const now = new Date();

  // 2. التحقق من بداية النافذة الزمنية
  if (session.startTime && now < new Date(session.startTime)) {
    throw new AppError('لم تبدأ الجلسة المباشرة بعد', 400, 'SESSION_NOT_STARTED');
  }

  // 3. التحقق من نهاية النافذة الزمنية
  if (session.endTime && now > new Date(session.endTime)) {
    throw new AppError('انتهت الجلسة المباشرة', 400, 'SESSION_ENDED');
  }

  // 4. التحقق من تسجيل الطالب في الكورس
  const isEnrolled = await isStudentEnrolledInCourse({
    studentId,
    courseId: targetCourseId,
  });

  if (!isEnrolled) {
    console.warn(`[AUDIT] محاولة انضمام غير مصرح بها من الطالب ${studentId} للجلسة ${sessionId}`);
    throw new AppError('الطالب غير مسجل في هذا الكورس', 400, 'NOT_ENROLLED');
  }

  // 5. إصدار رمز الانضمام (Join Token)
  const joinToken = signJoinToken({
    studentId,
    sessionId: session._id,
    courseId: targetCourseId,
  });

  // 6. تسجيل الحضور المبدئي تلقائياً (UC-ATT-04)
  if (typeof recordAttendanceAutomatically === 'function') {
    await recordAttendanceAutomatically({
      studentId,
      sessionId: session._id,
      courseId: targetCourseId,
    });
  }

  // 7. 🎯 توليد رابط Jitsi Meet التلقائي (في حال عدم وجود رابط محدد مسبقاً في الجلسة)
  const roomName = `SecureLearn_Session_${session._id}`;
  const defaultJitsiLink = `https://meet.jit.si/${roomName}`;

  const meetingLink = session.meetingLink || session.meeting_link || defaultJitsiLink;

  return {
    success: true,
    data: {
      joinToken,
      meetingLink, // 👈 إرجاع رابط Jitsi التلقائي أو الرابط المخزن
      courseId: targetCourseId,
    },
  };
}

module.exports = {
  joinLiveSession,
  isStudentEnrolledInCourse,
};
