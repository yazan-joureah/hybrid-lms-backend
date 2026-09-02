const {
  getInstructorCourseAnalytics,
} = require('../../services/report/instructorAnalytics.service');

async function getCourseAnalytics(req, res, next) {
  try {
    const result = await getInstructorCourseAnalytics({
      instructorId: req.user.id,
      courseId: req.params.courseId,
      req,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getCourseAnalytics };
