const { browseCourses, getCourseForUser } = require('../../services/courseService');

/** UC-COURSE-01: public course browsing. */
async function browse(req, res, next) {
  try {
    const result = await browseCourses({ queryParams: req.query });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** Unified role-aware course read (Guest, Student, Instructor, Admin) */
async function getCourse(req, res, next) {
  try {
    const userId = req.user?.id;
    const role = req.verifiedRole || req.user?.role;
    const { courseId } = req.params;

    const result = await getCourseForUser({ userId, role, courseId });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

module.exports = { browse, getCourse };
