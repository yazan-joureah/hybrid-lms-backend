const courseController = require('./course/course.controller');
const publicCourseController = require('./course/publicCourse.controller');
const enrollmentController = require('./course/enrollment.controller');
const contentController = require('./course/content.controller');
const courseImageController = require('./course/courseImage.controller');
const unitController = require('./course/unit.controller');

module.exports = {
  ...courseController,
  ...publicCourseController,
  ...enrollmentController,
  ...contentController,
  ...courseImageController,
  ...unitController,
};
