const kycReviewController = require('./admin/kycReview.controller');
const adminCourseController = require('./admin/adminCourse.controller');
const manageAccountsController = require('./admin/manageAccounts.controller');
const securityAuditStatsController = require('./admin/securityAuditStats.controller');
const adminAnalyticsController = require('./admin/adminAnalytics.controller');

module.exports = {
  ...kycReviewController,
  ...adminCourseController,
  ...manageAccountsController,
  ...securityAuditStatsController,
  ...adminAnalyticsController,
};
