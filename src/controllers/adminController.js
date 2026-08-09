const kycReviewController = require('./admin/kycReview.controller');
const adminCourseController = require('./admin/adminCourse.controller');

module.exports = {
  ...kycReviewController,
  ...adminCourseController,
};
