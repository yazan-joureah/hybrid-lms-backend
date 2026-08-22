// src/controllers/peerController.js — Facade (نفس نمط courseController.js)
const assignmentController = require('./peer/assignment.controller');
const submissionController = require('./peer/submission.controller');
const allocationController = require('./peer/allocation.controller');
const reviewController = require('./peer/review.controller');
const gradingController = require('./peer/grading.controller');

module.exports = {
  ...assignmentController,
  ...submissionController,
  ...allocationController,
  ...reviewController,
  ...gradingController,
};
