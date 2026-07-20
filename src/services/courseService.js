// src/services/courseService.js
const courseCoreService = require('./course/course.service');
const unitService = require('./course/unit.service');
const contentService = require('./course/content.service');
const reviewStateService = require('./course/reviewState.service');
const adminReviewService = require('./course/adminReview.service');

module.exports = {
  ...courseCoreService,
  ...unitService,
  ...contentService,
  cancelReviewRequest: reviewStateService.cancelReviewRequest,
  ...adminReviewService,
};
