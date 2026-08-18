// src/controllers/admin/adminCourse.controller.js
const {
  listPendingCourses,
  reviewCourse,
  setCourseStatus,
  listAllCoursesForAdmin,
} = require('../../services/courseService');

/** UC-COURSE-07: lists courses awaiting review. */
async function getPendingCourses(req, res, next) {
  try {
    const result = await listPendingCourses();
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** UC-COURSE-07: Admin publish/reject/needs_revision decision. */
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

/** Admin sets course status to suspended or archived. */
async function setCourseStatusHandler(req, res, next) {
  try {
    const adminId = req.user.id;
    const { courseId } = req.params;
    const { status } = req.body;

    const result = await setCourseStatus({ adminId, courseId, status, req });

    return res.status(200).json({
      success: true,
      message: `Course status updated to ${status}.`,
      data: { course: result.data.course },
    });
  } catch (err) {
    return next(err);
  }
}

async function getAllCoursesForAdmin(req, res, next) {
  try {
    const result = await listAllCoursesForAdmin({ queryParams: req.query });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getPendingCourses,
  reviewCourseHandler,
  setCourseStatusHandler,
  getAllCoursesForAdmin,
};
