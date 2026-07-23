const { enrollInCourse, listMyEnrollments } = require('../../services/courseService');

/** UC-COURSE-02: student enrollment. */
async function enroll(req, res, next) {
  try {
    const studentId = req.user.id;
    const { courseId } = req.params;
    const result = await enrollInCourse({ studentId, courseId, req });
    return res
      .status(201)
      .json({
        success: true,
        message: result.data.message,
        data: { enrollment: result.data.enrollment },
      });
  } catch (err) {
    return next(err);
  }
}

/** Lists the authenticated student's own enrollments. */
async function getMyEnrollments(req, res, next) {
  try {
    const studentId = req.user.id;
    const result = await listMyEnrollments({ studentId, queryParams: req.query });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

module.exports = { enroll, getMyEnrollments };
