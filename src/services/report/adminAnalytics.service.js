// src/services/report/adminAnalytics.service.js
// UC-REPORT-01 — View Admin Analytics Dashboard
const Enrollment = require('../../models/Enrollment');
const Payment = require('../../models/Payment');
const Attendance = require('../../models/attendance.model');
const LiveSession = require('../../models/liveSession.model');
const auditService = require('../auditService');
const { computeActiveAlertsForPlatform } = require('./alerts.service');

async function getAdminAnalyticsOverview({ actorId, actorRole, req }) {
  const [
    completedEnrollments,
    engagedEnrollments,
    freeActiveCount,
    paidActiveCount,
    totalEndedSessions,
    attendedCount,
    revenueAgg,
    activeAlerts,
  ] = await Promise.all([
    Enrollment.countDocuments({ status: 'completed' }),
    Enrollment.countDocuments({ status: { $in: ['active', 'completed'] } }),

    Enrollment.aggregate([
      { $match: { status: { $in: ['active', 'completed'] } } },
      { $lookup: { from: 'courses', localField: 'course_id', foreignField: '_id', as: 'course' } },
      { $unwind: '$course' },
      { $match: { 'course.course_type': 'free' } },
      { $count: 'count' },
    ]).then((r) => r[0]?.count || 0),

    Enrollment.aggregate([
      { $match: { status: { $in: ['active', 'completed'] } } },
      { $lookup: { from: 'courses', localField: 'course_id', foreignField: '_id', as: 'course' } },
      { $unwind: '$course' },
      { $match: { 'course.course_type': 'paid' } },
      { $count: 'count' },
    ]).then((r) => r[0]?.count || 0),

    LiveSession.countDocuments({ status: 'ended' }),
    Attendance.countDocuments({ status: { $in: ['present', 'partial'] } }),

    Payment.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),

    computeActiveAlertsForPlatform(),
  ]);

  const platformCompletionRate =
    engagedEnrollments > 0 ? completedEnrollments / engagedEnrollments : null;
  const platformAttendanceRate = totalEndedSessions > 0 ? attendedCount / totalEndedSessions : null;

  const paidRevenueTotal = revenueAgg[0]?.total || 0;
  const paidRevenueCount = revenueAgg[0]?.count || 0;
  const totalEnrollmentsForSplit = freeActiveCount + paidActiveCount;

  // SECURITY: absolute revenue figures are SuperAdmin-only — UC-REPORT-01
  // ext [a4]: "Admin Super يرى الأرقام الكاملة — Admin يرى التوزيع النسبي
  // فقط دون الأرقام المطلقة". Same financial-permission split already
  // established in UC-PAY-08 (API Keys reveal).
  const revenue =
    actorRole === 'SuperAdmin'
      ? { totalAmount: paidRevenueTotal, paidTransactionCount: paidRevenueCount }
      : {
          paidSharePercent:
            totalEnrollmentsForSplit > 0
              ? Math.round((paidActiveCount / totalEnrollmentsForSplit) * 1000) / 10
              : null,
        };

  await auditService.record({
    actorId,
    actorRole,
    action: 'VIEW_ADMIN_ANALYTICS_DASHBOARD',
    resourceType: 'platform_analytics',
    resourceId: 'overview',
    req,
  });

  return {
    error: null,
    platformCompletionRate,
    platformAttendanceRate,
    enrollmentDistribution: { free: freeActiveCount, paid: paidActiveCount },
    revenue,
    activeAlerts,
  };
}

module.exports = { getAdminAnalyticsOverview };
