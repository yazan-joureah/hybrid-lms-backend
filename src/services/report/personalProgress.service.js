// src/services/report/personalProgress.service.js

const Enrollment = require('../../models/Enrollment');
const LiveSession = require('../../models/liveSession.model');
const Attendance = require('../../models/attendance.model');
const QuizAttempt = require('../../models/quizAttempt.model');
const { getCompletionCounts } = require('../progress.service');
const { toObjectId } = require('../../utils/objectId.util');

const LATEST_QUIZ_RESULTS_LIMIT = 10;

/**
 * GET /report/me
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
        .filter((e) => e.course_id)
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
        .filter((a) => a.quiz_id)
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

async function computeOverallAttendancePercentage({ studentId, courseIds }) {
  if (courseIds.length === 0) return null;

  const [totalEndedSessions, attendedCount] = await Promise.all([
    LiveSession.countDocuments({ courseId: { $in: courseIds }, status: 'ended' }),
    Attendance.countDocuments({
      studentId,
      courseId: { $in: courseIds },
      status: { $in: ['present', 'partial'] },
    }),
  ]);

  if (totalEndedSessions === 0) return null;
  return Math.round((attendedCount / totalEndedSessions) * 1000) / 1000;
}

module.exports = { getPersonalProgressSummary };
