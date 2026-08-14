const courseCoreService = require('./course/course.service');
const unitService = require('./course/unit.service');
const reviewStateService = require('./course/reviewState.service');
const adminReviewService = require('./course/adminReview.service');
const publicCourseService = require('./course/publicCourse.service');
const enrollmentService = require('./course/enrollment.service');
const courseImageService = require('./course/courseImage.service');
const contentService = require('./course/content.service');

module.exports = {
  ...courseCoreService,
  ...unitService,
  ...contentService,
  ...reviewStateService,
  ...adminReviewService,
  ...publicCourseService,
  ...enrollmentService,
  ...courseImageService,
};
