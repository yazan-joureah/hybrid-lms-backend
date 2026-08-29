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
 *
 * التعديل: إضافة req، واستعلام session ليشمل unit_id و courseId،
 * واستدعاء recordLiveSessionCompletion عند الحضور الكامل.
 */
async function recordAttendanceLeave({ studentId, sessionId, req }) {
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

  // جلب معلومات الجلسة (بما فيها unit_id و courseId)
  const LiveSession = require('../../models/liveSession.model');
  const session = await LiveSession.findById(sessionId)
    .select('startTime endTime unit_id courseId')
    .lean();

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

  // DEVIATION: غير حرج عمداً — فشل تسجيل حدث التقدّم لا يجب أن يمنع تسجيل الحضور نفسه.
  if (session && record.status === 'present') {
    try {
      const { recordLiveSessionCompletion } = require('../progress.service');
      await recordLiveSessionCompletion({
        studentId,
        courseId: session.courseId,
        unitId: session.unit_id || null,
        sessionId,
        req,
      });
    } catch (err) {
      // eslint-disable-next-line no-console -- سيُستبدل بـ logger.js لاحقاً
      console.error('Live session progress recording failed (non-critical):', err.message);
    }
  }

  return { success: true, data: record };
}

/**
 * UC-LIVE-08 (تمديد) — تُستدعى من endSession() لحسم أي سجل حضور "مفتوح"
 * (leftAt: null) وقت إنهاء الجلسة.
 *
 * نقطة أساسية (واقعية): المرجع لحساب نسبة الحضور هو "المدة الفعلية التي
 * انعقدت فيها المحاضرة"، وليس المدة المجدولة دائماً:
 *   - إنهاء طبيعي (now >= endTime): المرجع = endTime - startTime (كالمعتاد).
 *   - إنهاء مبكر (now < endTime): المرجع = now - startTime (أي المدة
 *     الفعلية التي حاضر فيها المحاضر)، وليس الوقت المجدول أصلاً — طالب
 *     حضر من البداية للحظة الإنهاء الفعلي هو "حاضر كاملاً"، حتى لو
 *     المحاضرة انتهت أقصر من المخطط.
 *
 * الاحتساب بالتقدّم: كل سجل يُغلق هنا (present أو partial) يُحتسب "مكتمل"
 * بتقدّم الكورس — بخلاف recordAttendanceLeave العادية (التي تحتسب present
 * فقط)، لأن هنا الجلسة انتهت نهائياً ولا توجد فرصة أخرى للطالب ليحضر أكثر؛
 * القرار بيد المحاضر لا الطالب.
 */
async function finalizeSessionAttendance({ sessionId, req }) {
  const LiveSession = require('../../models/liveSession.model');
  const { recordLiveSessionCompletion } = require('../progress.service');

  const session = await LiveSession.findById(sessionId)
    .select('startTime endTime unit_id courseId')
    .lean();
  if (!session) return { closedCount: 0, endedEarly: false };

  const now = new Date();
  const scheduledStart = new Date(session.startTime);
  const scheduledEnd = new Date(session.endTime);
  const endedEarly = now < scheduledEnd;

  // المرجع الفعلي لطول المحاضرة المُنجزة فعلياً — وليس المخطط له بالضرورة.
  const effectiveDurationSeconds = endedEarly
    ? Math.max(1, Math.round((now - scheduledStart) / 1000))
    : Math.max(1, Math.round((scheduledEnd - scheduledStart) / 1000));

  const openRecords = await Attendance.find({ sessionId, leftAt: null });

  for (const record of openRecords) {
    const durationSeconds = Math.max(0, Math.round((now - record.joinedAt) / 1000));
    record.leftAt = now;
    record.durationSeconds = durationSeconds;

    const ratio = durationSeconds / effectiveDurationSeconds;
    record.status = ratio >= PRESENT_THRESHOLD_RATIO ? 'present' : 'partial';
    await record.save();

    // الجلسة انتهت نهائياً هنا (مبكراً أو بموعدها) — أي حالة حضور مسجَّلة
    // (present أو partial) تُحتسب مكتملة بالتقدّم، لأن الطالب لا يملك أي
    // فرصة إضافية ليحضر أكثر مما حضر.
    try {
      await recordLiveSessionCompletion({
        studentId: record.studentId,
        courseId: session.courseId,
        unitId: session.unit_id || null,
        sessionId,
        req,
      });
    } catch (err) {
      // eslint-disable-next-line no-console -- سيُستبدل بـ logger.js لاحقاً
      console.error(
        'Live session progress recording failed on finalize (non-critical):',
        err.message
      );
    }
  }

  return { closedCount: openRecords.length, endedEarly };
}

module.exports = {
  recordAttendanceAutomatically,
  recordAttendanceLeave,
  finalizeSessionAttendance,
  PRESENT_THRESHOLD_RATIO,
};
