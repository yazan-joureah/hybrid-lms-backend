// src/services/course/publicCourse.service.js
const Course = require('../../models/Course');
const { paginateQuery } = require('./courseAccess.util');

/**
 * SECURITY: escapes regex special characters in user-supplied search terms
 * before use in $regex — prevents both ReDoS and unintended pattern injection.
 */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function browseCourses({ queryParams = {} }) {
  const query = { status: 'published' };

  if (typeof queryParams.category === 'string' && queryParams.category.trim() !== '') {
    query.category = { $eq: queryParams.category.trim() };
  }
  if (typeof queryParams.search === 'string' && queryParams.search.trim() !== '') {
    query.title = { $regex: escapeRegex(queryParams.search.trim()), $options: 'i' };
  }

  const { records: courses, meta } = await paginateQuery({
    model: Course,
    query,
    queryParams,
    sort: { createdAt: -1 },
    select: '-rejection_reason -suspended_by',
  });

  return { success: true, data: { courses, meta } };
}

module.exports = { browseCourses };
