// src/controllers/courseController.js
const {
  createCourse,
  getInstructorCourses,
  updateCourse,
} = require('../services/course/course.service');

/**
 * Handles POST /api/v1/courses
 */
async function create(req, res, next) {
  try {
    const instructorId = req.user.id; // Populated by requireAuth middleware

    // Destructure only permitted fields from body to prevent Parameter Pollution
    const {
      title,
      description,
      course_type,
      price,
      is_synchronous,
      max_students,
      completion_threshold,
      category_id,
      subcategory_id,
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
      category_id,
      subcategory_id,
      prerequisite_course_ids,
    };

    const course = await createCourse({
      instructorId,
      courseData,
      req,
    });

    return res.status(201).json({
      success: true,
      message: 'Course draft created successfully.',
      data: {
        course,
      },
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/courses/instructor/my-courses
 */
async function getMyCourses(req, res, next) {
  try {
    const instructorId = req.user.id;
    const result = await getInstructorCourses(instructorId, req.query);

    return res.status(200).json({
      success: true,
      data: {
        courses: result.courses,
        meta: result.meta,
      },
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * PUT /api/v1/courses/:courseId
 */
async function update(req, res, next) {
  try {
    const instructorId = req.user.id;
    const { courseId } = req.params;

    // Whitelist allowed fields to prevent Mass Assignment vulnerabilities
    const {
      title,
      description,
      course_type,
      price,
      is_synchronous,
      max_students,
      completion_threshold,
      category_id,
      subcategory_id,
    } = req.body;

    // Filter out undefined values to only pass provided updates
    const updateData = Object.fromEntries(
      Object.entries({
        title,
        description,
        course_type,
        price,
        is_synchronous,
        max_students,
        completion_threshold,
        category_id,
        subcategory_id,
      }).filter(([_, v]) => v !== undefined)
    );

    const updatedCourse = await updateCourse({
      courseId,
      instructorId,
      updateData,
      req,
    });

    return res.status(200).json({
      success: true,
      message: 'Course updated successfully.',
      data: {
        course: updatedCourse,
      },
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  create,
  getMyCourses,
  update,
};
