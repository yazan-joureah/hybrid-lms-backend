// src/services/report/instructorAnalytics.service.js
// UC-REPORT-02 — View Instructor Analytics
const Course = require('../../models/Course');
const Quiz = require('../../models/quiz.model');
const QuizAttempt = require('../../models/quizAttempt.model');
const LiveSession = require('../../models/liveSession.model');
const Attendance = require('../../models/attendance.model');
const CourseContent = require('../../models/CourseContent');
const CourseProgressEvent = require('../../models/CourseProgressEvent');
const Enrollment = require('../../models/Enrollment');
const { AppError } = require('../../middleware/errorHandler');
const auditService = require('../auditService');
const { toObjectId } = require('../../utils/objectId.util');
const { computeAlertsForCourse } = require('./alerts.service');

async function assertOwnsCourse({ instructorId, courseId }) {
  const course = await Course.findById(courseId).select('owner_instructor_id title').lean();
  if (!course) {
    throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');
  }
  if (course.owner_instructor_id.toString() !== instructorId.toString()) {
    throw new AppError(403, 'FORBIDDEN', 'You do not own this course.');
  }
  return course;
}

/** GET /report/instructor/courses/:courseId — UC-REPORT-02. */
async function getInstructorCourseAnalytics({ instructorId, courseId, req }) {
  const safeInstructorId = toObjectId(instructorId, 'instructorId');
  const safeCourseId = toObjectId(courseId, 'courseId');

  const course = await assertOwnsCourse({
    instructorId: safeInstructorId,
    courseId: safeCourseId,
  });

  const [quizzes, totalContentCount, totalEndedSessions, enrolledStudents] = await Promise.all([
    Quiz.find({ course_id: safeCourseId, status: 'published' }).select('title quiz_type').lean(),
    CourseContent.countDocuments({ course_id: safeCourseId }),
    LiveSession.countDocuments({ courseId: safeCourseId, status: 'ended' }),
    Enrollment.find({ course_id: safeCourseId, status: { $in: ['active', 'completed'] } })
      .populate('student_id', 'full_name email')
      .lean(),
  ]);

  const quizIds = quizzes.map((q) => q._id);
  const quizStats = quizIds.length
    ? await QuizAttempt.aggregate([
        { $match: { quiz_id: { $in: quizIds }, status: 'graded' } },
        {
          $group: {
            _id: '$quiz_id',
            avgScore: { $avg: '$score_percent' },
            passCount: { $sum: { $cond: ['$passed', 1, 0] } },
            attemptCount: { $sum: 1 },
          },
        },
      ])
    : [];
  const quizStatsById = new Map(quizStats.map((s) => [s._id.toString(), s]));
  const quizPerformance = quizzes.map((q) => {
    const stats = quizStatsById.get(q._id.toString());
    return {
      quizId: q._id,
      title: q.title,
      quizType: q.quiz_type,
      averageScorePercent: stats ? Math.round(stats.avgScore * 10) / 10 : null,
      passRate: stats ? Math.round((stats.passCount / stats.attemptCount) * 1000) / 10 : null,
      attemptCount: stats ? stats.attemptCount : 0,
    };
  });

  // SECURITY/PRIVACY: full names ARE shown here, deliberately — the UC
  // text's own note is explicit that this is legitimate ("Instructor له
  // الحق المشروع" — the instructor is responsible for these specific
  // students), unlike UC-REPORT-01's platform-wide aggregates which
  // never expose any identity.
  const studentIds = enrolledStudents.map((e) => e.student_id?._id).filter(Boolean);
  const [completedContentByStudent, attendanceByStudent] = await Promise.all([
    CourseProgressEvent.aggregate([
      {
        $match: {
          course_id: safeCourseId,
          student_id: { $in: studentIds },
          source_type: 'content',
        },
      },
      { $group: { _id: '$student_id', count: { $sum: 1 } } },
    ]),
    Attendance.aggregate([
      {
        $match: {
          courseId: safeCourseId,
          studentId: { $in: studentIds },
          status: { $in: ['present', 'partial'] },
        },
      },
      { $group: { _id: '$studentId', count: { $sum: 1 } } },
    ]),
  ]);
  const contentByStudentMap = new Map(
    completedContentByStudent.map((c) => [c._id.toString(), c.count])
  );
  const attendanceByStudentMap = new Map(
    attendanceByStudent.map((a) => [a._id.toString(), a.count])
  );

  const students = enrolledStudents
    .filter((e) => e.student_id)
    .map((e) => {
      const sId = e.student_id._id.toString();
      const contentViewed = contentByStudentMap.get(sId) || 0;
      const attendedSessions = attendanceByStudentMap.get(sId) || 0;
      return {
        studentId: e.student_id._id,
        fullName: e.student_id.full_name,
        email: e.student_id.email,
        contentViewedCount: contentViewed,
        contentViewedPercent:
          totalContentCount > 0
            ? Math.round((contentViewed / totalContentCount) * 1000) / 10
            : null,
        attendedSessionsCount: attendedSessions,
        attendancePercent:
          totalEndedSessions > 0
            ? Math.round((attendedSessions / totalEndedSessions) * 1000) / 10
            : null,
      };
    });

  const courseLevelAlerts = await computeAlertsForCourse(safeCourseId);

  // Per-student below-threshold flags — the identity-revealing layer
  // UC-REPORT-02 explicitly allows and UC-REPORT-01 explicitly forbids.
  const flaggedStudents = students
    .filter(
      (s) =>
        (s.contentViewedPercent !== null && s.contentViewedPercent < 60) ||
        (s.attendancePercent !== null && s.attendancePercent < 70)
    )
    .map((s) => ({ studentId: s.studentId, fullName: s.fullName }));

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'VIEW_INSTRUCTOR_ANALYTICS',
    resourceType: 'Course',
    resourceId: safeCourseId.toString(),
    req,
  });

  return {
    error: null,
    courseTitle: course.title,
    quizPerformance,
    students,
    flaggedStudents,
    courseLevelAlerts,
  };
}

module.exports = { getInstructorCourseAnalytics };
