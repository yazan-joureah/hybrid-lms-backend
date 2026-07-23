// src/services/course/publicCourse.service.js
const Course = require('../../models/Course');
const CourseUnit = require('../../models/CourseUnit');
const CourseContent = require('../../models/CourseContent');
const { AppError } = require('../../middleware/errorHandler');

/**
 * UC-COURSE-01: lists published courses with optional category/search
 * filters.
 */
async function browseCourses({ queryParams = {} }) {
  const page = parseInt(queryParams.page, 10) || 1;
  const limit = parseInt(queryParams.limit, 10) || 10;
  const skip = (page - 1) * limit;

  const query = { status: 'published' };
  if (queryParams.category) {
    query.category = queryParams.category;
  }
  if (queryParams.search) {
    query.title = { $regex: queryParams.search, $options: 'i' };
  }

  const [courses, totalRecords] = await Promise.all([
    Course.find(query)
      .select('-rejection_reason -suspended_by')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Course.countDocuments(query),
  ]);

  return {
    success: true,
    data: {
      courses,
      meta: {
        total_records: totalRecords,
        current_page: page,
        total_pages: Math.ceil(totalRecords / limit),
      },
    },
  };
}

/**
 * UC-COURSE-01 step 5: fetches a single course's public details.
 * SECURITY: returns 404 (not 403) for any non-published course to avoid
 * confirming its existence to an unauthenticated/unauthorized user.
 */
async function getCourseDetails({ courseId }) {
  const course = await Course.findOne({ _id: courseId, status: 'published' })
    .select('-rejection_reason -suspended_by')
    .lean();

  if (!course) {
    throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');
  }

  return { success: true, data: { course } };
}

/**
 * returns the course regardless of status (draft/pending_review/etc.), plus its structural
 * outline (units + content counts), so the instructor can manage it
 * while building. Ownership-gated, NOT status-gated.
 */
async function getCourseForManage({ courseId, instructorId }) {
  const course = await Course.findById(courseId).lean();
  if (!course) {
    throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');
  }

  if (course.owner_instructor_id.toString() !== instructorId) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to view this course.');
  }

  const units = await CourseUnit.find({ course_id: courseId }).sort({ order: 1 }).lean();
  const unitIds = units.map((u) => u._id);
  const contentCounts = await CourseContent.aggregate([
    { $match: { unit_id: { $in: unitIds } } },
    { $group: { _id: '$unit_id', count: { $sum: 1 } } },
  ]);
  const countByUnit = new Map(contentCounts.map((c) => [c._id.toString(), c.count]));

  const unitsWithCounts = units.map((u) => ({
    ...u,
    content_count: countByUnit.get(u._id.toString()) || 0,
  }));

  return { success: true, data: { course, units: unitsWithCounts } };
}

module.exports = { browseCourses, getCourseDetails, getCourseForManage };
