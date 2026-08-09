const courseController = require('./course/course.controller');
const publicCourseController = require('./course/publicCourse.controller');
const enrollmentController = require('./course/enrollment.controller');
const progressController = require('./course/progress.controller');
const studentContentController = require('./course/studentContent.controller');
const courseImageController = require('./course/courseImage.controller'); // NEW

module.exports = {
  ...courseController,
  ...publicCourseController,
  ...enrollmentController,
  ...progressController,
  ...studentContentController,
  ...courseImageController,
};
