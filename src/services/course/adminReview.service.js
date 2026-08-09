// src/services/course/adminReview.service.js
/** UC-COURSE-07: Admin moderation of pending_review courses + suspend/archive/preview. */
const Course = require('../../models/Course');
const CourseUnit = require('../../models/CourseUnit');
const CourseContent = require('../../models/CourseContent');
const CourseReviewRequest = require('../../models/CourseReviewRequest');
const { AppError } = require('../../middleware/errorHandler');
const auditService = require('../auditService');
const { toObjectId } = require('../../utils/objectId.util');

/** UC-COURSE-07: lists all courses currently awaiting review. */
async function listPendingCourses() {
  const courses = await Course.find({ status: 'pending_review' }).sort({ updatedAt: 1 }).lean();
  return { success: true, data: { courses } };
}

/**
 * EXT-COURSE-02: checked ONLY at publish time — async courses need >=1
 * unit, every unit non-empty, and a set completion_threshold.
 */
async function assertContentCompleteForPublish(course) {
  if (course.is_synchronous) {
    return;
  }

  const units = await CourseUnit.find({ course_id: course._id }).lean();
  if (units.length === 0) {
    throw new AppError(400, 'NO_UNITS', 'Course has no units — cannot publish.');
  }

  const unitIds = units.map((u) => u._id);
  const contentCounts = await CourseContent.aggregate([
    { $match: { unit_id: { $in: unitIds } } },
    { $group: { _id: '$unit_id' } },
  ]);
  const unitsWithContent = new Set(contentCounts.map((c) => c._id.toString()));
  const emptyUnit = units.find((u) => !unitsWithContent.has(u._id.toString()));
  if (emptyUnit) {
    throw new AppError(
      400,
      'UNIT_HAS_NO_CONTENT',
      `Unit "${emptyUnit.title}" has no content — cannot publish.`
    );
  }

  if (course.completion_threshold === undefined || course.completion_threshold === null) {
    throw new AppError(
      400,
      'COMPLETION_THRESHOLD_MISSING',
      'Completion threshold is not set — cannot publish.'
    );
  }
}

/** UC-COURSE-07: records the Admin's publish/reject/needs_revision decision. */
async function reviewCourse({ courseId, adminId, decision, reason, req }) {
  const safeCourseId = toObjectId(courseId, 'courseId');
  const course = await Course.findById(safeCourseId);
  if (!course) {
    throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');
  }
  if (course.status !== 'pending_review') {
    throw new AppError(409, 'NOT_PENDING_REVIEW', 'Course is not currently pending review.');
  }

  const reviewRequest = await CourseReviewRequest.findOne({
    course_id: safeCourseId,
    status: 'pending_review',
  });

  if (decision === 'publish') {
    await assertContentCompleteForPublish(course);
    course.status = 'published';
    course.published_at = new Date();
    course.content_complete = true;
  } else if (decision === 'reject') {
    course.status = 'rejected';
    course.rejection_reason = reason;
  } else if (decision === 'needs_revision') {
    course.status = 'draft';
    course.rejection_reason = reason;
  } else {
    throw new AppError(
      400,
      'INVALID_DECISION',
      'decision must be one of: publish, reject, needs_revision.'
    );
  }

  await course.save();

  if (reviewRequest) {
    const statusMap = { publish: 'approved', reject: 'rejected', needs_revision: 'needs_revision' };
    reviewRequest.status = statusMap[decision];
    reviewRequest.reviewer_id = adminId;
    reviewRequest.rejection_reason = reason || null;
    reviewRequest.reviewed_at = new Date();
    await reviewRequest.save();
  }

  await auditService.record({
    actorId: adminId,
    actorRole: 'Admin',
    action: `COURSE_REVIEW_${decision.toUpperCase()}`,
    resourceType: 'Course',
    resourceId: safeCourseId.toString(),
    metadata: { decision, reason: reason || null },
    req,
  });

  return { success: true, data: { course } };
}

/**
 * Admin-facing full course structure preview: units + content metadata,

 */
async function getCoursePreviewForAdmin({ courseId }) {
  const safeCourseId = toObjectId(courseId, 'courseId');
  const course = await Course.findById(safeCourseId).lean();
  if (!course) {
    throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');
  }

  const units = await CourseUnit.find({ course_id: safeCourseId }).sort({ order: 1 }).lean();
  const unitIds = units.map((u) => u._id);
  const contents = await CourseContent.find({ unit_id: { $in: unitIds } })
    .sort({ order: 1 })
    .lean();

  const contentsByUnit = new Map();
  contents.forEach((c) => {
    const key = c.unit_id.toString();
    if (!contentsByUnit.has(key)) contentsByUnit.set(key, []);
    contentsByUnit.get(key).push({
      _id: c._id,
      content_type: c.content_type,
      order: c.order,
      content_data: c.content_data || null,
      mime_type: c.mime_type || null,
      size_bytes: c.size_bytes || null,
    });
  });

  const outline = units.map((u) => ({
    _id: u._id,
    title: u.title,
    order: u.order,
    content: contentsByUnit.get(u._id.toString()) || [],
  }));

  return { success: true, data: { course, units: outline } };
}

/**
 * Admin-specific wrapper: Fetches a single unit for admin review/moderation.
 * No ownership check - admins can access any course in any status.
 */
async function getUnitDetailsForAdmin({ courseId, unitId }) {
  // Import core function from unit.service
  const { _getUnitDetailsCore } = require('./unit.service');

  // Fetch core data (no status filter - admins can view all)
  const { course, unit, content } = await _getUnitDetailsCore({
    courseId,
    unitId,
    courseQuery: {}, // No restrictions - admins can access any status
  });

  // Format content with full metadata for admin review
  const formattedContent = content.map((c) => ({
    _id: c._id,
    content_type: c.content_type,
    order: c.order,
    content_data: c.content_data || null,
    storage_path: c.storage_path || null,
    mime_type: c.mime_type || null,
    size_bytes: c.size_bytes || null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));

  return {
    success: true,
    data: {
      unit: {
        ...unit,
        content: formattedContent,
        content_count: formattedContent.length,
      },
      course: {
        _id: course._id,
        title: course.title,
        status: course.status,
      },
    },
  };
}

const SETTABLE_ADMIN_STATUSES = ['suspended', 'archived'];

/**
 * Admin sets a course to suspended or archived.
 */
async function setCourseStatus({ adminId, courseId, status, req }) {
  const safeCourseId = toObjectId(courseId, 'courseId');

  if (!SETTABLE_ADMIN_STATUSES.includes(status)) {
    throw new AppError(400, 'INVALID_STATUS', 'status must be either suspended or archived.');
  }

  const course = await Course.findById(safeCourseId);
  if (!course) {
    throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');
  }
  if (course.status === 'archived') {
    throw new AppError(
      409,
      'COURSE_ARCHIVED',
      'Archived courses are in a terminal state and cannot be modified further.'
    );
  }
  if (course.status === status) {
    throw new AppError(409, 'ALREADY_IN_STATUS', `Course is already ${status}.`);
  }

  course.status = status;
  if (status === 'suspended') {
    course.suspended_by = adminId;
  }
  await course.save();

  await auditService.record({
    actorId: adminId,
    actorRole: 'Admin',
    action: `COURSE_${status.toUpperCase()}`,
    resourceType: 'Course',
    resourceId: safeCourseId.toString(),
    req,
  });

  return { success: true, data: { course } };
}

module.exports = {
  listPendingCourses,
  reviewCourse,
  getCoursePreviewForAdmin,
  getUnitDetailsForAdmin,
  setCourseStatus,
};
