// src/controllers/courseController.js
const courseController = require('./course/course.controller');
const publicCourseController = require('./course/publicCourse.controller');
const enrollmentController = require('./course/enrollment.controller');
const progressController = require('./course/progress.controller');
const studentContentController = require('./course/studentContent.controller');

module.exports = {
  ...courseController,
  ...publicCourseController,
  ...enrollmentController,
  ...progressController,
  ...studentContentController,
};
