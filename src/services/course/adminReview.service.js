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
  setCourseStatus,
};
