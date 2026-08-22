// src/services/peerService.js — Facade (نفس نمط courseService.js / liveService.js)
const assignmentService = require('./peer/assignment.service');
const submissionService = require('./peer/submission.service');
const allocationService = require('./peer/allocation.service');
const reviewService = require('./peer/review.service');
const gradingService = require('./peer/grading.service');

module.exports = {
  ...assignmentService,
  ...submissionService,
  ...allocationService,
  ...reviewService,
  ...gradingService,
};
