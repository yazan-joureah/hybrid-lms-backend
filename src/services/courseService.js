const courseCoreService = require('./course/course.service');
const unitService = require('./course/unit.service');
const contentService = require('./course/content.service');
const reviewStateService = require('./course/reviewState.service');
const adminReviewService = require('./course/adminReview.service');
const publicCourseService = require('./course/publicCourse.service');
const enrollmentService = require('./course/enrollment.service');
const progressService = require('./course/progress.service');
const studentContentService = require('./course/studentContent.service');

module.exports = {
  ...courseCoreService,
  ...unitService,
  ...contentService,
  cancelReviewRequest: reviewStateService.cancelReviewRequest,
  ...adminReviewService,
  ...publicCourseService,
  ...enrollmentService,
  ...progressService,
  ...studentContentService,
};
