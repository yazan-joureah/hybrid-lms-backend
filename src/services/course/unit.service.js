// src/services/course/unit.service.js
const Course = require('../../models/Course');
const CourseUnit = require('../../models/CourseUnit');
const { AppError } = require('../../middleware/errorHandler');
const auditService = require('../auditService');
const { assertCourseEditable, triggerReviewOnPublishedEdit } = require('./reviewState.service');
const { toObjectId } = require('../../utils/objectId.util');

async function addUnit({ courseId, instructorId, unitData, req }) {
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
      metadata: { target_owner: course.owner_instructor_id, attempted_action: 'ADD_UNIT' },
      req,
    });
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to modify this course.');
  }

  // Checked BEFORE any write — prevents an orphaned unit if the course
  // turns out to be non-editable
  assertCourseEditable(course);

  const existingUnitsCount = await CourseUnit.countDocuments({ course_id: safeCourseId });

  const unit = new CourseUnit({
    course_id: safeCourseId,
    title: unitData.title,
    order: existingUnitsCount + 1,
  });
  await unit.save();

  let reviewRequest = null;
  if (course.status === 'published') {
    reviewRequest = await triggerReviewOnPublishedEdit({
      course,
      instructorId: safeInstructorId,
      changeType: 'UNIT_ADDED',
      changesSnapshot: { unit_id: unit._id.toString(), title: unit.title },
      req,
    });
    await course.save();
  }

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'COURSE_UNIT_ADDED',
    resourceType: 'CourseUnit',
    resourceId: unit._id.toString(),
    metadata: {
      course_id: safeCourseId,
      title: unit.title,
      order: unit.order,
      review_request_id: reviewRequest?._id?.toString() || null,
    },
    req,
  });

  return { success: true, data: { unit } };
}

module.exports = { addUnit };
