// src/services/course/courseAccess.util.js
// Shared helpers used across every course service. Centralizes the
// "load course -> verify ownership -> (optionally) verify editable state"

const Course = require('../../models/Course');
const { AppError } = require('../../middleware/errorHandler');
const auditService = require('../auditService');
const { toObjectId } = require('../../utils/objectId.util');
const { assertCourseEditable } = require('./reviewState.service');

/**
 * Loads a course, verifies the given instructor owns it, and (optionally)
 * asserts it is currently editable.
 */
async function loadOwnedCourse({
  courseId,
  instructorId,
  req,
  requireEditable = false,
  attemptedAction = null,
}) {
  const safeCourseId = toObjectId(courseId, 'courseId');
  const safeInstructorId = toObjectId(instructorId, 'instructorId');

  const course = await Course.findById(safeCourseId);
  if (!course) {
    throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');
  }

  if (course.owner_instructor_id.toString() !== safeInstructorId.toString()) {
    await auditService.record({
      actorId: safeInstructorId,
      actorRole: 'Instructor',
      action: 'UNAUTHORIZED_COURSE_ACCESS_ATTEMPT',
      resourceType: 'Course',
      resourceId: safeCourseId,
      metadata: { target_owner: course.owner_instructor_id, attempted_action: attemptedAction },
      req,
    });
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to modify this course.');
  }

  if (requireEditable) {
    assertCourseEditable(course);
  }

  return { course, safeCourseId, safeInstructorId };
}

/** Shared pagination for every `Model.find(query)` list endpoint. */
async function paginateQuery({
  model,
  query,
  queryParams = {},
  sort,
  select,
  populate,
  defaultLimit = 10,
}) {
  const page = parseInt(queryParams.page, 10) || 1;
  const limit = parseInt(queryParams.limit, 10) || defaultLimit;
  const skip = (page - 1) * limit;

  let cursor = model.find(query);
  if (select) cursor = cursor.select(select);
  if (populate) cursor = cursor.populate(populate);
  if (sort) cursor = cursor.sort(sort);

  const [records, totalRecords] = await Promise.all([
    cursor.skip(skip).limit(limit).lean(),
    model.countDocuments(query),
  ]);

  return {
    records,
    meta: {
      total_records: totalRecords,
      current_page: page,
      total_pages: Math.ceil(totalRecords / limit),
    },
  };
}

module.exports = { loadOwnedCourse, paginateQuery };
