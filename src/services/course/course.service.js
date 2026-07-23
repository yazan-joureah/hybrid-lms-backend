// src/services/course/course.service.js
const Course = require('../../models/Course');
const User = require('../../models/User');
const CourseContent = require('../../models/CourseContent');
const CourseReviewRequest = require('../../models/CourseReviewRequest');
const auditService = require('../auditService');
const { AppError } = require('../../middleware/errorHandler');
const { assertCourseEditable, triggerReviewOnPublishedEdit } = require('./reviewState.service');
const { toObjectId } = require('../../utils/objectId.util');

//Creates a new course in 'draft' status.
async function createCourse({ instructorId, courseData, req }) {
  const safeInstructorId = toObjectId(instructorId, 'instructorId');
  const instructor = await User.findById(safeInstructorId);
  if (!instructor) {
    throw new AppError(404, 'INSTRUCTOR_NOT_FOUND', 'Instructor account does not exist.');
  }

  const newCourse = new Course({
    ...courseData,
    owner_instructor_id: safeInstructorId,
    status: 'draft',
    content_complete: false,
    published_at: null,
  });
  await newCourse.save();

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: instructor.role,
    action: 'COURSE_CREATED',
    resourceType: 'Course',
    resourceId: newCourse._id.toString(),
    metadata: { title: newCourse.title, course_type: newCourse.course_type },
    req,
  });

  return { success: true, data: { course: newCourse } };
}

// fetches all courses owned by the given instructor.
async function getInstructorCourses({ instructorId, queryParams = {} }) {
  const safeInstructorId = toObjectId(instructorId, 'instructorId');

  const page = parseInt(queryParams.page, 10) || 1;
  const limit = parseInt(queryParams.limit, 10) || 10;
  const skip = (page - 1) * limit;

  const query = { owner_instructor_id: safeInstructorId };

  const [courses, totalRecords] = await Promise.all([
    Course.find(query).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
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
 * Updates an existing course. Blocks all edits while
 * pending_review; re-triggers review if a sensitive field changes on a
 * published course.
 */
async function updateCourse({ courseId, instructorId, updateData, req }) {
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
      metadata: { target_owner: course.owner_instructor_id },
      req,
    });
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to modify this course.');
  }

  assertCourseEditable(course);

  const sensitiveFields = ['title', 'description', 'price', 'course_type', 'is_synchronous'];
  let sensitiveChangeDetected = false;
  const changesSnapshot = { before: {}, after: {} };

  sensitiveFields.forEach((field) => {
    if (updateData[field] !== undefined && updateData[field] !== course[field]) {
      sensitiveChangeDetected = true;
      changesSnapshot.before[field] = course[field];
      changesSnapshot.after[field] = updateData[field];
    }
  });

  let reviewRequest = null;
  if (sensitiveChangeDetected) {
    reviewRequest = await triggerReviewOnPublishedEdit({
      course,
      instructorId: safeInstructorId,
      changeType: 'FIELDS_UPDATED',
      changesSnapshot,
      req,
    });
  }

  Object.assign(course, updateData);
  await course.save();

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'COURSE_UPDATED',
    resourceType: 'Course',
    resourceId: safeCourseId,
    metadata: {
      status_changed_to: course.status,
      sensitive_change: sensitiveChangeDetected,
      changes: changesSnapshot,
      review_request_id: reviewRequest?._id?.toString() || null,
    },
    req,
  });

  return { success: true, data: { course } };
}

/**
 * Submits a course for admin review.
 * at least one CourseContent item must
 * exist — an empty course cannot be submitted.
 */
async function submitCourseForReview({ courseId, instructorId, req }) {
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
      action: 'UNAUTHORIZED_SUBMIT_REVIEW_ATTEMPT',
      resourceType: 'Course',
      resourceId: safeCourseId,
      metadata: { target_owner: course.owner_instructor_id },
      req,
    });
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to submit this course.');
  }

  if (course.status === 'pending_review') {
    throw new AppError(400, 'ALREADY_PENDING', 'Course is already pending review.');
  }
  if (course.status === 'published') {
    throw new AppError(400, 'ALREADY_PUBLISHED', 'Course is already published.');
  }

  // course must have content to be submitted
  const contentCount = await CourseContent.countDocuments({ course_id: safeCourseId });
  if (contentCount === 0) {
    throw new AppError(
      400,
      'COURSE_CONTENT_INCOMPLETE',
      'Course must have at least one content item before submission.'
    );
  }

  const snapshot = course.toObject();
  const reviewRequest = new CourseReviewRequest({
    course_id: course._id,
    requested_by: safeInstructorId,
    status: 'pending_review',
    changes_snapshot: snapshot,
  });
  await reviewRequest.save();

  course.status = 'pending_review';
  course.content_complete = true;
  await course.save();

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'COURSE_SUBMITTED_FOR_REVIEW',
    resourceType: 'CourseReviewRequest',
    resourceId: reviewRequest._id.toString(),
    metadata: { course_id: course._id.toString() },
    req,
  });

  return { success: true, data: { reviewRequest } };
}

module.exports = { createCourse, getInstructorCourses, updateCourse, submitCourseForReview };
