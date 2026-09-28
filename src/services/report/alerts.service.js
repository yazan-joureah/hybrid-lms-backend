// src/services/report/alerts.service.js
const Course = require('../../models/Course');
const Quiz = require('../../models/quiz.model');
const QuizAttempt = require('../../models/quizAttempt.model');
const LiveSession = require('../../models/liveSession.model');
const Attendance = require('../../models/attendance.model');

const DEFAULT_PERFORMANCE_THRESHOLD = 0.6;
const DEFAULT_ATTENDANCE_THRESHOLD = 0.7;

async function computeAlertsForCourse(courseId) {
  const alerts = [];

  const publishedQuizIds = await Quiz.distinct('_id', {
    course_id: courseId,
    status: 'published',
  });

  if (publishedQuizIds.length > 0) {
    const [perf] = await QuizAttempt.aggregate([
      { $match: { quiz_id: { $in: publishedQuizIds }, status: 'graded' } },
      { $group: { _id: null, avgScore: { $avg: '$score_percent' } } },
    ]);
    if (perf && perf.avgScore / 100 < DEFAULT_PERFORMANCE_THRESHOLD) {
      alerts.push({
        type: 'LOW_PERFORMANCE',
        courseId,
        value: Math.round(perf.avgScore) / 100,
        threshold: DEFAULT_PERFORMANCE_THRESHOLD,
        severity: perf.avgScore / 100 < DEFAULT_PERFORMANCE_THRESHOLD / 2 ? 'high' : 'medium',
      });
    }
  }

  const totalEndedSessions = await LiveSession.countDocuments({ courseId, status: 'ended' });
  if (totalEndedSessions > 0) {
    const attendedCount = await Attendance.countDocuments({
      courseId,
      status: { $in: ['present', 'partial'] },
    });

    const rate = attendedCount / totalEndedSessions;
    if (rate < DEFAULT_ATTENDANCE_THRESHOLD) {
      alerts.push({
        type: 'LOW_ATTENDANCE',
        courseId,
        value: Math.round(rate * 1000) / 1000,
        threshold: DEFAULT_ATTENDANCE_THRESHOLD,
        severity: rate < DEFAULT_ATTENDANCE_THRESHOLD / 2 ? 'high' : 'medium',
      });
    }
  }

  return alerts;
}

async function computeActiveAlertsForPlatform() {
  const courses = await Course.find({ status: 'published' }).select('_id title').lean();
  const perCourseAlerts = await Promise.all(
    courses.map(async (c) => {
      const alerts = await computeAlertsForCourse(c._id);
      return alerts.map((a) => ({ ...a, courseTitle: c.title }));
    })
  );
  return perCourseAlerts.flat();
}

module.exports = { computeAlertsForCourse, computeActiveAlertsForPlatform };
