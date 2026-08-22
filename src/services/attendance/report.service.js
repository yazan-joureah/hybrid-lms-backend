// src/services/attendance/report.service.js
// UC-ATT-02 — Export Attendance Reports

const mongoose = require('mongoose');
const Attendance = require('../../models/attendance.model');
const LiveSession = require('../../models/liveSession.model');
const Course = require('../../models/Course');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');
const { buildCsv } = require('../../utils/csv.util');
const auditService = require('../auditService');

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
    {
      $match: {
        courseId: new mongoose.Types.ObjectId(safeCourseId),
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
    {
      $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'student' },
    },
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

module.exports = {
  getSessionAttendanceReport,
  exportSessionAttendanceCSV,
  getCourseAttendanceSummary,
};
