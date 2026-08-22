// src/services/course/courseAccess.util.js

const Course = require('../../models/Course');
const { toObjectId } = require('../../utils/objectId.util');
const { assertCourseEditable } = require('./reviewState.service');
const { loadOwnedResource } = require('../../utils/ownedResource.util');

async function loadOwnedCourse({
  courseId,
  instructorId,
  req,
  requireEditable = false,
  attemptedAction = null,
}) {
  const safeCourseId = toObjectId(courseId, 'courseId');
  const safeInstructorId = toObjectId(instructorId, 'instructorId');

  const course = await loadOwnedResource({
    model: Course,
    resourceId: safeCourseId,
    actorId: safeInstructorId,
    ownerField: 'owner_instructor_id',
    resourceType: 'Course',
    notFoundCode: 'COURSE_NOT_FOUND',
    notFoundMessage: 'Course not found.',
    forbiddenMessage: 'You do not have permission to modify this course.',
    unauthorizedAction: 'UNAUTHORIZED_COURSE_ACCESS_ATTEMPT',
    auditMetadata: { attempted_action: attemptedAction },
    req,
  });

  if (requireEditable) {
    assertCourseEditable(course);
  }

  return { course, safeCourseId, safeInstructorId };
}

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
