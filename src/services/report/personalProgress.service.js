// src/services/report/personalProgress.service.js
// UC-REPORT-03 — View Personal Progress Summary
//
// DESIGN NOTE (from the UC text itself): deliberately does NOT call
// SF-AUTH-01 or SF-AUTH-03 — a Student viewing their OWN data needs
// neither role-verification nor MFA/KYC, only a valid session. This
// keeps friction minimal by design, not by oversight.
//
// Reuses getCompletionCounts() from course/progress.service.js rather
// than recomputing per-course completion logic — same Golden Rule
// ("As Simple As Possible" / no duplicated SF logic) already applied
// throughout COURSE/QUIZ/PEER.

const Enrollment = require('../../models/Enrollment');
const LiveSession = require('../../models/liveSession.model');
const Attendance = require('../../models/attendance.model');
const QuizAttempt = require('../../models/quizAttempt.model');
const { getCompletionCounts } = require('../progress.service');
const { toObjectId } = require('../../utils/objectId.util');

const LATEST_QUIZ_RESULTS_LIMIT = 10;

/**
 * GET /report/me — UC-REPORT-03.
 * Returns:
 *  - per-course completion percentage for every actively-enrolled course
 *  - the student's most recent graded quiz/exam results (across all courses)
 *  - one overall attendance percentage across every ended live session in
 *    every enrolled course (FR-29's "نسبة الحضور الكلية" — a single
 *    platform-wide figure, not per-course)
 */
async function getPersonalProgressSummary({ studentId }) {
  const safeStudentId = toObjectId(studentId, 'studentId');

  const enrollments = await Enrollment.find({
    student_id: safeStudentId,
    status: { $in: ['active', 'completed'] },
  })
    .populate('course_id', 'title completion_threshold')
    .lean();

  const courseIds = enrollments.map((e) => e.course_id?._id).filter(Boolean);

  const [courseProgress, latestQuizResults, overallAttendance] = await Promise.all([
    Promise.all(
      enrollments
        .filter((e) => e.course_id) // defensive: course could theoretically be gone
        .map(async (e) => {
          const { percentage, completedCount, totalCount } = await getCompletionCounts({
            courseId: e.course_id._id,
            studentId: safeStudentId,
          });
          return {
            courseId: e.course_id._id,
            courseTitle: e.course_id.title,
            enrollmentStatus: e.status,
            progressPercentage: percentage,
            completedCount,
            totalCount,
          };
        })
    ),

    QuizAttempt.find({ student_id: safeStudentId, status: 'graded' })
      .sort({ graded_at: -1 })
      .limit(LATEST_QUIZ_RESULTS_LIMIT)
      .populate({ path: 'quiz_id', select: 'title quiz_type course_id' })
      .lean(),

    computeOverallAttendancePercentage({ studentId: safeStudentId, courseIds }),
  ]);

  return {
    success: true,
    data: {
      courses: courseProgress,
      latestQuizResults: latestQuizResults
        .filter((a) => a.quiz_id) // quiz could have been deleted after grading
        .map((a) => ({
          quizId: a.quiz_id._id,
          quizTitle: a.quiz_id.title,
          quizType: a.quiz_id.quiz_type,
          courseId: a.quiz_id.course_id,
          scorePercent: a.score_percent,
          passed: a.passed,
          gradedAt: a.graded_at,
        })),
      overallAttendancePercentage: overallAttendance,
    },
  };
}

/**
 * One platform-wide figure: attended (present/partial) ÷ total ENDED live
 * sessions across every course the student is/was actively enrolled in.
 * No $lookup needed — Attendance.courseId is denormalized on the model
 * specifically for queries like this one.
 */
async function computeOverallAttendancePercentage({ studentId, courseIds }) {
  if (courseIds.length === 0) return null; // no enrollments at all — distinct from 0%

  const [totalEndedSessions, attendedCount] = await Promise.all([
    LiveSession.countDocuments({ courseId: { $in: courseIds }, status: 'ended' }),
    Attendance.countDocuments({
      studentId,
      courseId: { $in: courseIds },
      status: { $in: ['present', 'partial'] },
    }),
  ]);

  if (totalEndedSessions === 0) return null; // no synchronous sessions have concluded yet
  return Math.round((attendedCount / totalEndedSessions) * 1000) / 1000; // 3-decimal fraction, matches getCompletionCounts' style
}

module.exports = { getPersonalProgressSummary };
