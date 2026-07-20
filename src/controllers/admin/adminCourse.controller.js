const { listPendingCourses, reviewCourse } = require('../../services/courseService');

/**lists courses awaiting review. */
async function getPendingCourses(req, res, next) {
  try {
    const result = await listPendingCourses();
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** Admin publish/reject/needs_revision decision. */
async function reviewCourseHandler(req, res, next) {
  try {
    const adminId = req.user.id;
    const { courseId } = req.params;
    const { decision, reason } = req.body;

    const result = await reviewCourse({ courseId, adminId, decision, reason, req });

    return res.status(200).json({
      success: true,
      message: `Course review decision recorded: ${decision}.`,
      data: { course: result.data.course },
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getPendingCourses, reviewCourseHandler };
