// src/controllers/course/course.controller.js
const {
  createCourse,
  getInstructorCourses,
  updateCourse,
  submitCourseForReview,
  addUnit,
  addContent,
  cancelReviewRequest,
} = require('../../services/courseService');

/** creates a course draft. */
async function create(req, res, next) {
  try {
    const instructorId = req.user.id;
    const {
      title,
      description,
      course_type,
      price,
      is_synchronous,
      max_students,
      completion_threshold,
      category,
      prerequisite_course_ids,
    } = req.body;

    const courseData = {
      title,
      description,
      course_type,
      price: course_type === 'free' ? 0 : price,
      is_synchronous,
      max_students: is_synchronous === true ? max_students : null,
      completion_threshold,
      category,
      prerequisite_course_ids,
    };

    const result = await createCourse({ instructorId, courseData, req });

    return res.status(201).json({
      success: true,
      message: 'Course draft created successfully.',
      data: { course: result.data.course },
    });
  } catch (err) {
    return next(err);
  }
}

/** fetches the authenticated instructor's own courses (paginated). */
async function getMyCourses(req, res, next) {
  try {
    const instructorId = req.user.id;
    const result = await getInstructorCourses({ instructorId, queryParams: req.query });

    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** updates course fields; may trigger re-review if published. */
async function update(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId } = req.params;
    const {
      title,
      description,
      course_type,
      price,
      is_synchronous,
      max_students,
      completion_threshold,
      category,
    } = req.body;

    const updateData = Object.fromEntries(
      Object.entries({
        title,
        description,
        course_type,
        price,
        is_synchronous,
        max_students,
        completion_threshold,
        category,
      }).filter(([_, v]) => v !== undefined)
    );

    const result = await updateCourse({ courseId, instructorId, updateData, req });

    return res.status(200).json({
      success: true,
      message: 'Course updated successfully.',
      data: { course: result.data.course },
    });
  } catch (err) {
    return next(err);
  }
}

/** submits a course for admin review. */
async function submitForReview(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId } = req.params;

    const result = await submitCourseForReview({ courseId, instructorId, req });

    return res.status(200).json({
      success: true,
      message: 'Course submitted for review successfully.',
      data: { reviewRequest: result.data.reviewRequest },
    });
  } catch (err) {
    return next(err);
  }
}

/** adds a unit to a course. */
async function createUnit(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId } = req.params;
    const { title } = req.body;

    const result = await addUnit({ courseId, instructorId, unitData: { title }, req });

    return res.status(201).json({
      success: true,
      message: 'Unit added successfully.',
      data: { unit: result.data.unit },
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * adds a content item to a unit.
 */
async function createContent(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId, unitId } = req.params;
    const { content_type: contentType, url, text } = req.body;

    const contentData =
      contentType === 'link' ? { url } : contentType === 'text' ? { text } : undefined;

    const result = await addContent({
      courseId,
      unitId,
      instructorId,
      contentType,
      file: req.file,
      contentData,
      req,
    });

    return res.status(201).json({
      success: true,
      message: 'Content added successfully.',
      data: { content: result.data.content },
    });
  } catch (err) {
    return next(err);
  }
}

/** Cancels an active pending review request, reverting the course to draft. */
async function cancelReview(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId } = req.params;

    const result = await cancelReviewRequest({ courseId, instructorId, req });

    return res.status(200).json({
      success: true,
      message: 'Review request cancelled. Course reverted to draft.',
      data: { course: result.data.course },
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  create,
  getMyCourses,
  update,
  submitForReview,
  createUnit,
  createContent,
  cancelReview,
};
