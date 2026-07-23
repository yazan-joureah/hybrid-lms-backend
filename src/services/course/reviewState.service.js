// src/services/course/reviewState.service.js
const Course = require('../../models/Course');
const CourseReviewRequest = require('../../models/CourseReviewRequest');
const { AppError } = require('../../middleware/errorHandler');
const auditService = require('../auditService');
const { toObjectId } = require('../../utils/objectId.util');

const BLOCKED_STATUSES = ['suspended', 'archived'];

/** Throws if the course cannot be modified right now. Call BEFORE any write. */
function assertCourseEditable(course) {
  if (BLOCKED_STATUSES.includes(course.status)) {
    throw new AppError(
      409,
      'COURSE_NOT_EDITABLE',
      `Cannot modify course while status is '${course.status}'.`
    );
  }
  if (course.status === 'pending_review') {
    throw new AppError(
      409,
      'REVIEW_IN_PROGRESS',
      'A review request is already pending. Cancel it before making further changes.'
    );
  }
}

/**
 * If the course is currently published, flips it to pending_review
 *  and opens a new CourseReviewRequest.
 */
async function triggerReviewOnPublishedEdit({
  course,
  instructorId,
  changeType,
  changesSnapshot,
  req,
}) {
  if (course.status !== 'published') {
    return null;
  }

  course.status = 'pending_review';

  const safeInstructorId = toObjectId(instructorId, 'instructorId');

  const reviewRequest = new CourseReviewRequest({
    course_id: course._id,
    requested_by: safeInstructorId,
    status: 'pending_review',
    changes_snapshot: { change_type: changeType, ...changesSnapshot },
  });
  await reviewRequest.save();

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'COURSE_REVIEW_REQUESTED',
    resourceType: 'CourseReviewRequest',
    resourceId: reviewRequest._id.toString(),
    metadata: { course_id: course._id.toString(), change_type: changeType },
    req,
  });

  return reviewRequest;
}

/** Cancels an active pending review request and reverts the course to draft. */
async function cancelReviewRequest({ courseId, instructorId, req }) {
  const safeCourseId = toObjectId(courseId, 'courseId');
  const safeInstructorId = toObjectId(instructorId, 'instructorId');

  const course = await Course.findById(safeCourseId);
  if (!course) {
    throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');
  }
  if (course.owner_instructor_id.toString() !== safeInstructorId.toString()) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to modify this course.');
  }
  if (course.status !== 'pending_review') {
    throw new AppError(409, 'NO_ACTIVE_REVIEW', 'No pending review request to cancel.');
  }

  const activeRequest = await CourseReviewRequest.findOne({
    course_id: safeCourseId,
    status: 'pending_review',
  });
  if (activeRequest) {
    activeRequest.status = 'cancelled';
    await activeRequest.save();
  }

  course.status = 'draft';
  await course.save();

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'COURSE_REVIEW_CANCELLED',
    resourceType: 'Course',
    resourceId: safeCourseId,
    metadata: { review_request_id: activeRequest?._id?.toString() || null },
    req,
  });

  return { success: true, data: { course } };
}

module.exports = { assertCourseEditable, triggerReviewOnPublishedEdit, cancelReviewRequest };
