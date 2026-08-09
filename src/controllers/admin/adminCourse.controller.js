// src/controllers/admin/adminCourse.controller.js
const {
  listPendingCourses,
  reviewCourse,
  getCoursePreviewForAdmin,
  getUnitDetailsForAdmin: getUnitDetailsForAdminService,
  setCourseStatus,
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

/** Full course structure preview for Admin (units + content metadata, no file binaries). */
async function getCoursePreview(req, res, next) {
  try {
    const { courseId } = req.params;
    const result = await getCoursePreviewForAdmin({ courseId });
    return res.status(200).json({ success: true, data: result.data });
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

/** Fetches a single unit with all content for admin review. */
async function getUnitDetailsForAdmin(req, res, next) {
  try {
    const { courseId, unitId } = req.params;

    const result = await getUnitDetailsForAdminService({ courseId, unitId });

    return res.status(200).json({
      success: true,
      data: result.data,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getPendingCourses,
  reviewCourseHandler,
  getCoursePreview,
  getUnitDetailsForAdmin,
  setCourseStatusHandler,
};
