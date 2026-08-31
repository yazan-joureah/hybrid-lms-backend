// src/services/course/adminReview.service.js
const Course = require('../../models/Course');
const CourseUnit = require('../../models/CourseUnit');
const CourseContent = require('../../models/CourseContent');
const CourseReviewRequest = require('../../models/CourseReviewRequest');
const { AppError } = require('../../middleware/errorHandler');
const auditService = require('../auditService');
const { assertPublishedExamExists } = require('./course.service');
const { toObjectId } = require('../../utils/objectId.util');
const { paginateQuery } = require('./courseAccess.util');

async function listPendingCourses() {
  const courses = await Course.find({ status: 'pending_review' }).sort({ updatedAt: 1 }).lean();
  return { success: true, data: { courses } };
}

async function assertContentCompleteForPublish(course) {
  await assertPublishedExamExists(course._id);

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

async function reviewCourse({ courseId, adminId, decision, reason, req }) {
  const safeCourseId = toObjectId(courseId, 'courseId');
  const safeAdminId = toObjectId(adminId, 'adminId');

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
    reviewRequest.reviewer_id = safeAdminId;
    reviewRequest.rejection_reason = reason || null;
    reviewRequest.reviewed_at = new Date();
    await reviewRequest.save();
  }

  await auditService.record({
    actorId: safeAdminId,
    actorRole: 'Admin',
    action: `COURSE_REVIEW_${decision.toUpperCase()}`,
    resourceType: 'Course',
    resourceId: safeCourseId.toString(),
    metadata: { decision, reason: reason || null },
    req,
  });

  return { success: true, data: { course } };
}

async function listAllCoursesForAdmin({ queryParams = {} }) {
  const query = {};
  if (queryParams.status) {
    query.status = queryParams.status;
  }

  const { records: courses, meta } = await paginateQuery({
    model: Course,
    query,
    queryParams,
    sort: { updatedAt: -1 },
    defaultLimit: 20,
  });

  return { success: true, data: { courses, meta } };
}

const SETTABLE_ADMIN_STATUSES = ['suspended', 'archived', 'published'];

async function setCourseStatus({ adminId, courseId, status, req }) {
  const safeCourseId = toObjectId(courseId, 'courseId');
  const safeAdminId = toObjectId(adminId, 'adminId');

  if (!SETTABLE_ADMIN_STATUSES.includes(status)) {
    throw new AppError(
      400,
      'INVALID_STATUS',
      'status must be one of: suspended, archived, published.'
    );
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

  // إعادة التفعيل (unsuspend) مسار خاص — مسموح فقط من suspended إلى
  // published، عشان ما ينكسر منطق "publish الأصلي" (assertContentCompleteForPublish
  // إلخ) اللي بينفّذ فقط ضمن reviewCourse. هون إحنا بس عم نعكس تعليق سابق.
  if (status === 'published') {
    if (course.status !== 'suspended') {
      throw new AppError(
        409,
        'INVALID_TRANSITION',
        'Only a suspended course can be reactivated back to published.'
      );
    }
    course.suspended_by = null;
  }

  course.status = status;
  if (status === 'suspended') {
    course.suspended_by = safeAdminId;
  }
  await course.save();

  await auditService.record({
    actorId: safeAdminId,
    actorRole: 'Admin',
    action: status === 'published' ? 'COURSE_REACTIVATED' : `COURSE_${status.toUpperCase()}`,
    resourceType: 'Course',
    resourceId: safeCourseId.toString(),
    req,
  });

  return { success: true, data: { course } };
}

module.exports = { listPendingCourses, reviewCourse, setCourseStatus, listAllCoursesForAdmin };
