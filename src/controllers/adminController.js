const kycReviewController = require('./admin/kycReview.controller');
const adminCourseController = require('./admin/adminCourse.controller');
const manageAccountsController = require('./admin/manageAccounts.controller');

module.exports = {
  ...kycReviewController,
  ...adminCourseController,
  ...manageAccountsController,
};
