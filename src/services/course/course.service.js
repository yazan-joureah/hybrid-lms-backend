// src/services/course/course.service.js
const Course = require('../../models/Course');
const User = require('../../models/User');
const CourseUnit = require('../../models/CourseUnit');
const CourseContent = require('../../models/CourseContent');
const fileStorage = require('../fileStorage.service');
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

/**
 * Deletes a course entirely — DRAFT/REJECTED status only (confirmed
 * decision). Published courses with real enrollments need archival
 * handling, not deletion — out of scope for now, deliberately.
 */
async function deleteCourse({ courseId, instructorId, req }) {
  const course = await Course.findById(courseId);
  if (!course) {
    throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');
  }
  if (course.owner_instructor_id.toString() !== instructorId) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to delete this course.');
  }
  if (!['draft', 'rejected'].includes(course.status)) {
    throw new AppError(
      409,
      'COURSE_NOT_DELETABLE',
      'Only draft or rejected courses can be deleted.'
    );
  }

  const units = await CourseUnit.find({ course_id: courseId });
  const unitIds = units.map((u) => u._id);
  const contents = await CourseContent.find({ unit_id: { $in: unitIds } });

  for (const content of contents) {
    if (content.storage_path) {
      // eslint-disable-next-line no-await-in-loop
      const fileId = content.storage_path.split('/').pop();
      // eslint-disable-next-line no-await-in-loop
      await fileStorage
        .deleteFile({ fileId, userId: instructorId, actorRole: 'Instructor', req })
        .catch(() => {});
    }
  }

  await CourseContent.deleteMany({ unit_id: { $in: unitIds } });
  await CourseUnit.deleteMany({ course_id: courseId });
  await course.deleteOne();

  await auditService.record({
    actorId: instructorId,
    actorRole: 'Instructor',
    action: 'COURSE_DELETED',
    resourceType: 'Course',
    resourceId: courseId,
    metadata: { deleted_units: units.length, deleted_content: contents.length },
    req,
  });

  return { success: true, data: { deleted: true } };
}

async function getCourseForUser({ userId, role, courseId }) {
  const safeCourseId = toObjectId(courseId, 'courseId');

  if (role === 'Instructor' || ['Admin', 'SuperAdmin'].includes(role)) {
    const course = await Course.findById(safeCourseId).lean();
    if (!course) throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');

    if (
      role === 'Instructor' &&
      course.owner_instructor_id.toString() !== toObjectId(userId, 'userId').toString()
    ) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have permission to view this course.');
    }
    return { success: true, data: { course } };
  }

  // Guest or Student: published only, 404 otherwise (UC-COURSE-01 [a5] pattern)
  const course = await Course.findOne({ _id: safeCourseId, status: 'published' })
    .select('-rejection_reason -suspended_by')
    .lean();
  if (!course) throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');

  return { success: true, data: { course } };
}

module.exports = {
  createCourse,
  getInstructorCourses,
  updateCourse,
  submitCourseForReview,
  deleteCourse,
  getCourseForUser,
};
