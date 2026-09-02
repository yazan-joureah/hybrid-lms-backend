const kycReviewController = require('./admin/kycReview.controller');
const adminCourseController = require('./admin/adminCourse.controller');
const manageAccountsController = require('./admin/manageAccounts.controller');
const securityAuditStatsController = require('./admin/securityAuditStats.controller');

module.exports = {
  ...kycReviewController,
  ...adminCourseController,
  ...manageAccountsController,
  ...securityAuditStatsController,
};
