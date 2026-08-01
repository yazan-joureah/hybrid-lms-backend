const Attendance = require('../models/attendance.model');

/**
 * UC-ATT-04 — Record Attendance Automatically (هيكل أولي Preliminary Skeleton)
 *
 * DEVIATION: هذا تنفيذ مبدئي مقصود. يغطي فقط خطوات 1-2 من سيناريو UC-ATT-04
 * (استقبال إشارة الانضمام + تسجيل وقت الدخول). خطوات المراقبة المستمرة للاتصال
 * وتحديد الحضور الجزئي عند نهاية الجلسة (خطوات 3-4) تتطلب منطق وحدة ATT الكامل
 * ولا تُبنى إلا بعد اكتمال LIVE بالكامل، حسب تسلسل البناء اليدوي المتفق عليه.
 */
async function recordAttendanceAutomatically({ studentId, sessionId, courseId }) {
  // Idempotent عبر القيد الفريد { sessionId, studentId } في النموذج — لا تكرار عند إعادة الانضمام
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

module.exports = { recordAttendanceAutomatically };
