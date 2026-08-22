// src/services/attendance/tracking.service.js
// UC-ATT-01 — Auto-Record Attendance

const Attendance = require('../../models/attendance.model');
const { AppError } = require('../../middleware/errorHandler');

// حد أدنى لاعتبار الحضور "كاملاً" مقابل "جزئياً" — نسبة من مدة الجلسة
// (قيمة افتراضية معقولة؛ حوّليها لاحقاً إلى حقل قابل للتهيئة لكل كورس عند الحاجة)
const PRESENT_THRESHOLD_RATIO = 0.75;

/**
 * UC-ATT-01 خطوات 1-2 — تُستدعى من UC-LIVE-04 عند نجاح الانضمام فعلياً.
 * Idempotent عبر القيد الفريد { sessionId, studentId } في النموذج.
 */
async function recordAttendanceAutomatically({ studentId, sessionId, courseId }) {
  const existing = await Attendance.findOne({ sessionId, studentId });
  if (existing) {
    return { success: true, data: existing };
  }

  const record = await Attendance.create({
    sessionId,
    studentId,
    courseId,
    joinedAt: new Date(),
    status: 'preliminary',
    source: 'auto_join',
  });

  return { success: true, data: record };
}

/**
 * UC-ATT-01 خطوات 3-4 — تُستدعى عند مغادرة الطالب (endpoint صريح أو قطع اتصال Socket).
 * تحسب مدة البقاء الفعلية وتحدد الحالة النهائية بمقارنتها بمدة الجلسة.
 */
async function recordAttendanceLeave({ studentId, sessionId }) {
  const record = await Attendance.findOne({ sessionId, studentId });
  if (!record) {
    throw new AppError(404, 'ATTENDANCE_NOT_FOUND', 'لا يوجد سجل حضور لهذا الطالب في هذه الجلسة.');
  }

  // Idempotent: مغادرة مسجَّلة مسبقاً لا تُعاد كتابتها (مثلاً قطع اتصال متبوع بطلب مغادرة صريح)
  if (record.leftAt) {
    return { success: true, data: record };
  }

  const now = new Date();
  const durationSeconds = Math.max(0, Math.round((now - record.joinedAt) / 1000));

  record.leftAt = now;
  record.durationSeconds = durationSeconds;

  // خطوة 4 من UC-ATT-01: تحديد "حضور جزئي" إن انقطع الاتصال قبل وقتٍ كافٍ من مدة
  // الجلسة — الحسم النهائي (present/partial/absent) يُراجَع لاحقاً من المحاضر
  // عبر UC-ATT-03 (تعديل يدوي) إن لزم؛ هذا فقط تصنيف أولي تلقائي.
  const LiveSession = require('../../models/liveSession.model');
  const session = await LiveSession.findById(sessionId).select('startTime endTime').lean();
  if (session) {
    const sessionDurationSeconds = Math.max(
      1,
      Math.round((new Date(session.endTime) - new Date(session.startTime)) / 1000)
    );
    const ratio = durationSeconds / sessionDurationSeconds;
    record.status = ratio >= PRESENT_THRESHOLD_RATIO ? 'present' : 'partial';
  } else {
    record.status = 'present';
  }

  await record.save();

  return { success: true, data: record };
}

module.exports = { recordAttendanceAutomatically, recordAttendanceLeave, PRESENT_THRESHOLD_RATIO };
