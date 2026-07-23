const {
  browseCourses,
  getCourseDetails,
  getCourseForManage,
} = require('../../services/courseService');

/** UC-COURSE-01: public course browsing. */
async function browse(req, res, next) {
  try {
    const result = await browseCourses({ queryParams: req.query });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** UC-COURSE-01 step 5: public course details, 404 if not published. */
async function getDetails(req, res, next) {
  try {
    const { courseId } = req.params;
    const result = await getCourseDetails({ courseId });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** Instructor view of own course regardless of status. */
async function getManage(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId } = req.params;
    const result = await getCourseForManage({ courseId, instructorId });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

module.exports = { browse, getDetails, getManage };
