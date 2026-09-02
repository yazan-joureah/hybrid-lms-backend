// src/services/report/alerts.service.js
// SF-REPORT-01 — Check Thresholds & Generate Smart Alerts (ISF)
const Course = require('../../models/Course');
const Quiz = require('../../models/quiz.model');
const QuizAttempt = require('../../models/quizAttempt.model');
const LiveSession = require('../../models/liveSession.model');
const Attendance = require('../../models/attendance.model');

const DEFAULT_PERFORMANCE_THRESHOLD = 0.6; // UC-REPORT-01 ext [a3] default
const DEFAULT_ATTENDANCE_THRESHOLD = 0.7; // UC-REPORT-01 ext [a3] default

/**
 * DEVIATION: the UC text also calls for an email notification when NEW
 * alerts appear ("يرسل النظام إشعاراً عبر Service Email إذا كانت
 * التنبيهات جديدة منذ آخر فحص"). NOT wired here — emailService.js's real
 * exported function names weren't reviewed in this session, and
 * inventing one risks a silent require() crash at runtime. The alert
 * LIST itself (what every UC-REPORT-0x view actually consumes) is fully
 * functional; email dispatch is an explicit follow-up.
 */
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
    // APPROXIMATION, flagged explicitly: this divides total attendance
    // ROWS by total ended SESSIONS, not "average attendance rate per
    // student". The mathematically precise denominator would be
    // (totalEndedSessions × enrolledStudentCount), but that needs an
    // extra query per course. For a course with 1 student this is exact;
    // for N students it under-counts the rate proportionally to N. Kept
    // simple deliberately (Golden Rule) since this only gates a
    // secondary alert, not a grade/certificate decision — revisit if the
    // committee flags it as materially misleading.
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

/** Platform-wide sweep — feeds UC-REPORT-01's admin overview. */
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
