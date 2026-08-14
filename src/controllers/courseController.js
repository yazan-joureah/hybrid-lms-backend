const courseController = require('./course/course.controller');
const publicCourseController = require('./course/publicCourse.controller');
const enrollmentController = require('./course/enrollment.controller');
const progressController = require('./course/progress.controller');
const ContentController = require('./course/content.controller');
const courseImageController = require('./course/courseImage.controller');
const unitController = require('../controllers/course/unit.controller');

module.exports = {
  ...courseController,
  ...publicCourseController,
  ...enrollmentController,
  ...progressController,
  ...ContentController,
  ...courseImageController,
  ...unitController,
};
