// src/services/course/publicCourse.service.js
const Course = require('../../models/Course');

/**
 * SECURITY: escapes regex special characters in user-supplied search terms
 * before use in $regex — prevents both ReDoS (a maliciously crafted pattern
 * hanging the regex engine) and unintended pattern injection.
 */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * lists published courses with optional category/search
 * filters.
 */
async function browseCourses({ queryParams = {} }) {
  const page = parseInt(queryParams.page, 10) || 1;
  const limit = parseInt(queryParams.limit, 10) || 10;
  const skip = (page - 1) * limit;

  const query = { status: 'published' };

  if (typeof queryParams.category === 'string' && queryParams.category.trim() !== '') {
    query.category = { $eq: queryParams.category.trim() };
  }

  if (typeof queryParams.search === 'string' && queryParams.search.trim() !== '') {
    const escapedSearch = escapeRegex(queryParams.search.trim());
    query.title = { $regex: escapedSearch, $options: 'i' };
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

module.exports = { browseCourses };
