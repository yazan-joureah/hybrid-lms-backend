// src/controllers/course/course.controller.js
const {
  createCourse,
  getInstructorCourses,
  updateCourse,
  submitCourseForReview,
  addUnit,
  getUnitDetails: getUnitDetailsService,
  addContent,
  cancelReviewRequest,
  updateUnit: updateUnitService,
  deleteUnit: deleteUnitService,
  reorderUnits: reorderUnitsService,
  updateContent: updateContentService,
  deleteContent: deleteContentService,
  reorderContent: reorderContentService,
  deleteCourse: deleteCourseService,
  getEnrollmentPreview: getEnrollmentPreviewService,
  getCourseStudents: getCourseStudentsService,
  getProgressSummary: getProgressSummaryService,
  getUnitDetailsForStudent: getUnitDetailsForStudentService,
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

/** adds a content item to a unit. */
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
      data: { content: result.data.content, unit_content: result.data.unit_content },
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

async function updateUnit(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId, unitId } = req.params;
    const { title, desc } = req.body;

    const updateData = Object.fromEntries(
      Object.entries({ title, desc }).filter(([_, v]) => v !== undefined)
    );

    const result = await updateUnitService({ courseId, unitId, instructorId, updateData, req });

    return res.status(200).json({
      success: true,
      message: 'Unit updated successfully.',
      data: { unit: result.data.unit },
    });
  } catch (err) {
    return next(err);
  }
}

async function deleteUnit(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId, unitId } = req.params;
    await deleteUnitService({ courseId, unitId, instructorId, req });
    return res.status(200).json({ success: true, message: 'Unit deleted successfully.' });
  } catch (err) {
    return next(err);
  }
}

async function reorderUnits(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId } = req.params;
    const result = await reorderUnitsService({
      courseId,
      instructorId,
      orderedUnitIds: req.body.ordered_unit_ids,
      req,
    });
    return res.status(200).json({ success: true, data: { units: result.data.units } });
  } catch (err) {
    return next(err);
  }
}

/** Fetches a single unit with all its content items. */
async function getUnitDetails(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId, unitId } = req.params;

    const result = await getUnitDetailsService({ courseId, unitId, instructorId });

    return res.status(200).json({
      success: true,
      data: result.data,
    });
  } catch (err) {
    return next(err);
  }
}

async function updateContent(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId, unitId, contentId } = req.params;
    const { url, text } = req.body;
    const result = await updateContentService({
      courseId,
      unitId,
      contentId,
      instructorId,
      contentData: { url, text },
      file: req.file,
      req,
    });
    return res.status(200).json({ success: true, data: { content: result.data.content } });
  } catch (err) {
    return next(err);
  }
}

async function deleteContent(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId, unitId, contentId } = req.params;
    await deleteContentService({ courseId, unitId, contentId, instructorId, req });
    return res.status(200).json({ success: true, message: 'Content deleted successfully.' });
  } catch (err) {
    return next(err);
  }
}

async function reorderContent(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId, unitId } = req.params;
    const result = await reorderContentService({
      courseId,
      unitId,
      instructorId,
      orderedContentIds: req.body.ordered_content_ids,
      req,
    });
    return res.status(200).json({ success: true, data: { content: result.data.content } });
  } catch (err) {
    return next(err);
  }
}

async function deleteCourse(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId } = req.params;
    await deleteCourseService({ courseId, instructorId, req });
    return res.status(200).json({ success: true, message: 'Course deleted successfully.' });
  } catch (err) {
    return next(err);
  }
}

async function getEnrollmentPreview(req, res, next) {
  try {
    const { courseId } = req.params;
    const result = await getEnrollmentPreviewService({ courseId });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

async function getCourseStudents(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId } = req.params;
    const result = await getCourseStudentsService({
      instructorId,
      courseId,
      queryParams: req.query,
    });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

async function getProgressSummary(req, res, next) {
  try {
    const studentId = req.user.id;
    const { courseId } = req.params;
    const result = await getProgressSummaryService({ studentId, courseId });
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return next(err);
  }
}

/** Fetches a single unit with progress tracking for students. */
async function getUnitDetailsForStudent(req, res, next) {
  try {
    const studentId = req.user.id;
    const { courseId, unitId } = req.params;

    const result = await getUnitDetailsForStudentService({ studentId, courseId, unitId });

    return res.status(200).json({
      success: true,
      data: result.data,
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
  getUnitDetails,
  createContent,
  cancelReview,
  updateUnit,
  deleteUnit,
  reorderUnits,
  updateContent,
  deleteContent,
  reorderContent,
  deleteCourse,
  getEnrollmentPreview,
  getCourseStudents,
  getProgressSummary,
  getUnitDetailsForStudent,
};
