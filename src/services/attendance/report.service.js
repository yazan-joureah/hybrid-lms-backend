// src/services/attendance/report.service.js
// UC-ATT-02 — Export Attendance Reports
// UC-ATT-03 — Manual Attendance Correction

const mongoose = require('mongoose');
const Attendance = require('../../models/attendance.model');
const LiveSession = require('../../models/liveSession.model');
const Course = require('../../models/Course');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');
const { buildCsv } = require('../../utils/csv.util');
const auditService = require('../auditService');
const { recordLiveSessionCompletion } = require('../progress.service');

/** يتحقق أن المحاضر يملك الكورس، أو أن المستخدم Admin/SuperAdmin */
async function assertCanViewCourseAttendance({ userId, role, courseId }) {
  if (role === 'Admin' || role === 'SuperAdmin') return;

  const course = await Course.findById(courseId).select('owner_instructor_id').lean();
  if (!course) {
    throw new AppError(404, 'COURSE_NOT_FOUND', 'الكورس غير موجود.');
  }
  if (course.owner_instructor_id.toString() !== userId.toString()) {
    throw new AppError(403, 'FORBIDDEN', 'لا تملك صلاحية الاطلاع على حضور هذا الكورس.');
  }
}

/**
 * UC-ATT-02 — تقرير حضور جلسة واحدة (JSON) مع اسم الطالب وبريده
 */
async function getSessionAttendanceReport({ userId, role, sessionId }) {
  const safeSessionId = toObjectId(sessionId, 'sessionId');
  const session = await LiveSession.findById(safeSessionId).lean();
  if (!session) {
    throw new AppError(404, 'SESSION_NOT_FOUND', 'الجلسة غير موجودة.');
  }

  await assertCanViewCourseAttendance({ userId, role, courseId: session.courseId });

  const records = await Attendance.find({ sessionId: safeSessionId })
    .populate('studentId', 'full_name email')
    .sort({ joinedAt: 1 })
    .lean();

  return { success: true, data: { session, records } };
}

/**
 * UC-ATT-02 — نفس التقرير أعلاه لكن بصيغة CSV جاهزة للتنزيل
 */
async function exportSessionAttendanceCSV({ userId, role, sessionId, req }) {
  const { data } = await getSessionAttendanceReport({ userId, role, sessionId });

  const rows = data.records.map((r) => ({
    student_name: r.studentId?.full_name || '',
    student_email: r.studentId?.email || '',
    joined_at: r.joinedAt ? new Date(r.joinedAt).toISOString() : '',
    left_at: r.leftAt ? new Date(r.leftAt).toISOString() : '',
    duration_seconds: r.durationSeconds || 0,
    status: r.status,
    source: r.source,
  }));

  const csv = buildCsv(
    [
      'student_name',
      'student_email',
      'joined_at',
      'left_at',
      'duration_seconds',
      'status',
      'source',
    ],
    rows
  );

  await auditService.record({
    actorId: userId,
    actorRole: role,
    action: 'ATTENDANCE_REPORT_EXPORTED',
    resourceType: 'LiveSession',
    resourceId: String(sessionId),
    metadata: { format: 'csv', recordCount: rows.length },
    req,
  });

  return { success: true, data: { csv, filename: `attendance_session_${sessionId}.csv` } };
}

/**
 * UC-ATT-02 — ملخص نسبة الحضور لكل طالب عبر كل جلسات كورس معيّن
 */
async function getCourseAttendanceSummary({ userId, role, courseId }) {
  const safeCourseId = toObjectId(courseId, 'courseId');
  await assertCanViewCourseAttendance({ userId, role, courseId: safeCourseId });

  const totalSessions = await LiveSession.countDocuments({
    courseId: safeCourseId,
    status: 'ended',
  });

  const summary = await Attendance.aggregate([
    { $match: { courseId: new mongoose.Types.ObjectId(safeCourseId) } },
    {
      $lookup: {
        from: LiveSession.collection.name,
        localField: 'sessionId',
        foreignField: '_id',
        as: 'session',
      },
    },
    { $unwind: '$session' },
    {
      $match: {
        'session.status': 'ended',
        status: { $in: ['present', 'partial'] },
      },
    },
    {
      $group: {
        _id: '$studentId',
        attendedSessions: { $sum: 1 },
        totalDurationSeconds: { $sum: '$durationSeconds' },
      },
    },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'student' } },
    { $unwind: '$student' },
    {
      $project: {
        _id: 0,
        studentId: '$_id',
        studentName: '$student.full_name',
        studentEmail: '$student.email',
        attendedSessions: 1,
        totalDurationSeconds: 1,
        attendancePercentage: {
          $cond: [
            { $eq: [totalSessions, 0] },
            0,
            {
              $round: [{ $multiply: [{ $divide: ['$attendedSessions', totalSessions] }, 100] }, 1],
            },
          ],
        },
      },
    },
    { $sort: { studentName: 1 } },
  ]);

  return { success: true, data: { totalSessions, summary } };
}

/**
 * UC-ATT-03 — Manual Attendance Correction (present فقط)
 * محصور بالمحاضر مالك الكورس حصراً — وليس Admin/SuperAdmin هنا، خلافاً
 * لبقية دوال هذا الملف (قرار مقصود، وليس إغفالاً).
 * يعيد استخدام recordLiveSessionCompletion حرفياً — بلا تكرار منطق
 * إنشاء CourseProgressEvent، وهي Idempotent أصلاً بنفس idempotency_key.
 */
async function correctAttendanceToPresent({ instructorId, sessionId, studentId, reason, req }) {
  const safeSessionId = toObjectId(sessionId, 'sessionId');
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeInstructorId = toObjectId(instructorId, 'instructorId');

  if (!reason || !reason.trim()) {
    throw new AppError(400, 'REASON_REQUIRED', 'سبب التصحيح مطلوب.');
  }

  const session = await LiveSession.findById(safeSessionId).lean();
  if (!session) {
    throw new AppError(404, 'SESSION_NOT_FOUND', 'الجلسة غير موجودة.');
  }

  // محصور بمالك الكورس فقط — قرار مقصود يختلف عن assertCanViewCourseAttendance أعلاه
  const course = await Course.findById(session.courseId).select('owner_instructor_id').lean();
  if (!course || course.owner_instructor_id.toString() !== safeInstructorId.toString()) {
    throw new AppError(403, 'FORBIDDEN', 'لا تملك صلاحية تصحيح حضور هذه الجلسة.');
  }

  const record = await Attendance.findOne({ sessionId: safeSessionId, studentId: safeStudentId });
  if (!record) {
    throw new AppError(404, 'ATTENDANCE_NOT_FOUND', 'لا يوجد سجل حضور لهذا الطالب في هذه الجلسة.');
  }

  if (record.status === 'present') {
    return { success: true, data: { record, alreadyPresent: true } };
  }

  record.status = 'present';
  record.correctionReason = reason.trim();
  record.correctedBy = safeInstructorId;
  record.correctedAt = new Date();
  await record.save();

  // DEVIATION: غير حرج عمداً، بنفس نمط tracking.service.js — فشل تسجيل
  // حدث التقدّم لا يجب أن يمنع حفظ التصحيح نفسه.
  if (session.unit_id) {
    try {
      await recordLiveSessionCompletion({
        studentId: safeStudentId,
        courseId: session.courseId,
        unitId: session.unit_id,
        sessionId: safeSessionId,
        req,
      });
    } catch (err) {
      // eslint-disable-next-line no-console -- سيُستبدل بـ logger.js لاحقاً
      console.error(
        'Live session progress recording failed after correction (non-critical):',
        err.message
      );
    }
  }

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'ATTENDANCE_MANUALLY_CORRECTED',
    resourceType: 'Attendance',
    resourceId: record._id.toString(),
    metadata: {
      sessionId: safeSessionId.toString(),
      studentId: safeStudentId.toString(),
      reason: reason.trim(),
    },
    req,
  });

  return { success: true, data: { record } };
}

module.exports = {
  getSessionAttendanceReport,
  exportSessionAttendanceCSV,
  getCourseAttendanceSummary,
  correctAttendanceToPresent,
};
