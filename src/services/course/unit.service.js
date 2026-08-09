// src/services/course/unit.service.js
const Course = require('../../models/Course');
const CourseUnit = require('../../models/CourseUnit');
const CourseContent = require('../../models/CourseContent');
const { AppError } = require('../../middleware/errorHandler');
const auditService = require('../auditService');
const { assertCourseEditable, triggerReviewOnPublishedEdit } = require('./reviewState.service');
const { toObjectId } = require('../../utils/objectId.util');
const fileStorage = require('../fileStorage.service');

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

  assertCourseEditable(course);

  const existingUnitsCount = await CourseUnit.countDocuments({ course_id: safeCourseId });

  const unit = new CourseUnit({
    course_id: safeCourseId,
    title: unitData.title,
    desc: unitData.desc,
    order: existingUnitsCount + 1,
  });
  await unit.save();

  let reviewRequest = null;
  if (course.status === 'published') {
    reviewRequest = await triggerReviewOnPublishedEdit({
      course,
      instructorId: safeInstructorId,
      changeType: 'UNIT_ADDED',
      changesSnapshot: { unit_id: unit._id.toString(), title: unit.title, desc: unit.desc },
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

/** Updates a unit*/
async function updateUnit({ courseId, unitId, instructorId, updateData, req }) {
  const safeCourseId = toObjectId(courseId, 'courseId');
  const safeInstructorId = toObjectId(instructorId, 'instructorId');
  const safeUnitId = toObjectId(unitId, 'unitId');

  const course = await Course.findById(safeCourseId);
  if (!course) {
    throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');
  }
  if (course.owner_instructor_id.toString() !== safeInstructorId.toString()) {
    await auditService.record({
      actorId: safeInstructorId,
      actorRole: 'Instructor',
      action: 'UNAUTHORIZED_UNIT_ACCESS_ATTEMPT',
      resourceType: 'Unit',
      resourceId: safeUnitId,
      metadata: { target_owner: course.owner_instructor_id },
      req,
    });
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to modify this course.');
  }

  assertCourseEditable(course);

  const unit = await CourseUnit.findOne({ _id: safeUnitId, course_id: safeCourseId });
  if (!unit) {
    throw new AppError(404, 'UNIT_NOT_FOUND', 'Unit not found for this course.');
  }

  // Update only allowed fields
  if (updateData.title !== undefined) {
    unit.title = updateData.title;
  }
  if (updateData.desc !== undefined) {
    unit.desc = updateData.desc;
  }
  await unit.save();

  let reviewRequest = null;
  if (course.status === 'published') {
    reviewRequest = await triggerReviewOnPublishedEdit({
      course,
      instructorId: safeInstructorId,
      changeType: 'UNIT_UPDATED',
      changesSnapshot: {
        unit_id: unit._id.toString(),
        new_title: updateData.title,
        new_desc: updateData.desc,
      },
      req,
    });
    await course.save();
  }

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'COURSE_UNIT_UPDATED',
    resourceType: 'CourseUnit',
    resourceId: unit._id.toString(),
    metadata: {
      course_id: safeCourseId,
      review_request_id: reviewRequest?._id?.toString() || null,
    },
    req,
  });

  return { success: true, data: { unit } };
}

/**
 * Deletes a unit and CASCADES to all its content items
 */
async function deleteUnit({ courseId, unitId, instructorId, req }) {
  const course = await Course.findById(courseId);
  if (!course) {
    throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');
  }
  if (course.owner_instructor_id.toString() !== instructorId) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to modify this course.');
  }
  assertCourseEditable(course);

  const unit = await CourseUnit.findOne({ _id: unitId, course_id: courseId });
  if (!unit) {
    throw new AppError(404, 'UNIT_NOT_FOUND', 'Unit not found for this course.');
  }

  // Cascade: delete each content item's GridFS file first, then the DB records
  const contents = await CourseContent.find({ unit_id: unitId });
  for (const content of contents) {
    if (content.storage_path) {
      // eslint-disable-next-line no-await-in-loop -- sequential cleanup, low volume per unit
      const fileId = content.storage_path.split('/').pop();
      // eslint-disable-next-line no-await-in-loop
      await fileStorage
        .deleteFile({ fileId, userId: instructorId, actorRole: 'Instructor', req })
        .catch(() => {});
    }
  }
  await CourseContent.deleteMany({ unit_id: unitId });
  await unit.deleteOne();

  const remainingUnits = await CourseUnit.find({ course_id: courseId }).sort({ order: 1 });
  await Promise.all(
    remainingUnits.map((u, index) => {
      u.order = index + 1;
      return u.save();
    })
  );

  let reviewRequest = null;
  if (course.status === 'published') {
    reviewRequest = await triggerReviewOnPublishedEdit({
      course,
      instructorId,
      changeType: 'UNIT_DELETED',
      changesSnapshot: { unit_id: unitId, deleted_content_count: contents.length },
      req,
    });
    await course.save();
  }

  await auditService.record({
    actorId: instructorId,
    actorRole: 'Instructor',
    action: 'COURSE_UNIT_DELETED',
    resourceType: 'CourseUnit',
    resourceId: unitId,
    metadata: {
      course_id: courseId,
      deleted_content_count: contents.length,
      review_request_id: reviewRequest?._id?.toString() || null,
    },
    req,
  });

  return { success: true, data: { deleted: true } };
}

/**
 * Reorders ALL units in one call.
 */
async function reorderUnits({ courseId, instructorId, orderedUnitIds, req }) {
  const course = await Course.findById(courseId);
  if (!course) {
    throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');
  }
  if (course.owner_instructor_id.toString() !== instructorId) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to modify this course.');
  }
  assertCourseEditable(course);

  const existingUnits = await CourseUnit.find({ course_id: courseId });
  const existingIds = existingUnits.map((u) => u._id.toString()).sort();
  const providedIds = [...orderedUnitIds].sort();

  if (JSON.stringify(existingIds) !== JSON.stringify(providedIds)) {
    throw new AppError(
      400,
      'INVALID_UNIT_SET',
      "The provided unit list does not match this course's units exactly."
    );
  }

  await Promise.all(
    orderedUnitIds.map((unitId, index) =>
      CourseUnit.updateOne({ _id: unitId }, { order: index + 1 })
    )
  );

  const reorderedUnits = await CourseUnit.find({ course_id: courseId }).sort({ order: 1 }).lean();

  await auditService.record({
    actorId: instructorId,
    actorRole: 'Instructor',
    action: 'COURSE_UNITS_REORDERED',
    resourceType: 'Course',
    resourceId: courseId,
    metadata: { new_order: orderedUnitIds },
    req,
  });

  return { success: true, data: { units: reorderedUnits } };
}

/**
 * Core function: Fetches unit + content without authorization.
 * INTERNAL USE ONLY - always wrap with role-specific authorization.
 * @private
 */
async function _getUnitDetailsCore({ courseId, unitId, courseQuery = {} }) {
  const safeCourseId = toObjectId(courseId, 'courseId');
  const safeUnitId = toObjectId(unitId, 'unitId');

  // Fetch course with optional query filters (e.g., status for students)
  const course = await Course.findOne({ _id: safeCourseId, ...courseQuery }).lean();
  if (!course) {
    throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');
  }

  // Fetch unit
  const unit = await CourseUnit.findOne({ _id: safeUnitId, course_id: safeCourseId }).lean();
  if (!unit) {
    throw new AppError(404, 'UNIT_NOT_FOUND', 'Unit not found for this course.');
  }

  // Fetch all content items for this unit, sorted by order
  const content = await CourseContent.find({ unit_id: safeUnitId }).sort({ order: 1 }).lean();

  return { course, unit, content };
}

/**
 * Instructor-specific wrapper: Fetches a single unit with all its content items.
 * Enforces ownership check.
 */
async function getUnitDetails({ courseId, unitId, instructorId }) {
  const safeInstructorId = toObjectId(instructorId, 'instructorId');

  // Authorization: ownership check
  const course = await Course.findById(courseId);
  if (!course) {
    throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');
  }
  if (course.owner_instructor_id.toString() !== safeInstructorId.toString()) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to view this course.');
  }

  // Fetch core data
  const { unit, content } = await _getUnitDetailsCore({ courseId, unitId });

  // Format content with full metadata for instructors
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
    },
  };
}

module.exports = {
  addUnit,
  reorderUnits,
  deleteUnit,
  updateUnit,
  getUnitDetails,
  _getUnitDetailsCore,
};
