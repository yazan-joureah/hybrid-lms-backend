// src/services/course/unit.service.js
const Course = require('../../models/Course');
const CourseUnit = require('../../models/CourseUnit');
const CourseContent = require('../../models/CourseContent');
const Enrollment = require('../../models/Enrollment');
const CourseProgressEvent = require('../../models/CourseProgressEvent');
const Attendance = require('../../models/attendance.model');
const { AppError } = require('../../middleware/errorHandler');
const auditService = require('../auditService');
const { revertToDraftOnPublishedEdit } = require('./reviewState.service');
const { toObjectId } = require('../../utils/objectId.util');
const { loadOwnedCourse } = require('./courseAccess.util');
const fileStorage = require('../fileStorage.service');

async function addUnit({ courseId, instructorId, unitData, req }) {
  const { course, safeCourseId, safeInstructorId } = await loadOwnedCourse({
    courseId,
    instructorId,
    req,
    requireEditable: true,
    attemptedAction: 'ADD_UNIT',
  });

  const existingUnitsCount = await CourseUnit.countDocuments({ course_id: safeCourseId });

  const unit = new CourseUnit({
    course_id: safeCourseId,
    title: unitData.title,
    desc: unitData.desc,
    order: existingUnitsCount + 1,
  });
  await unit.save();

  let revertedToDraft = false;
  if (course.status === 'published') {
    revertedToDraft = await revertToDraftOnPublishedEdit({
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
      reverted_to_draft: revertedToDraft,
    },
    req,
  });

  return { success: true, data: { unit } };
}

async function updateUnit({ courseId, unitId, instructorId, updateData, req }) {
  const { course, safeCourseId, safeInstructorId } = await loadOwnedCourse({
    courseId,
    instructorId,
    req,
    requireEditable: true,
    attemptedAction: 'UPDATE_UNIT',
  });
  const safeUnitId = toObjectId(unitId, 'unitId');

  const unit = await CourseUnit.findOne({ _id: safeUnitId, course_id: safeCourseId });
  if (!unit) {
    throw new AppError(404, 'UNIT_NOT_FOUND', 'Unit not found for this course.');
  }

  if (updateData.title !== undefined) unit.title = updateData.title;
  if (updateData.desc !== undefined) unit.desc = updateData.desc;
  await unit.save();

  let revertedToDraft = false;
  if (course.status === 'published') {
    revertedToDraft = await revertToDraftOnPublishedEdit({
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
      reverted_to_draft: revertedToDraft,
    },
    req,
  });

  return { success: true, data: { unit } };
}

/** Deletes a unit and CASCADES to all its content items. */
async function deleteUnit({ courseId, unitId, instructorId, req }) {
  const { course, safeCourseId, safeInstructorId } = await loadOwnedCourse({
    courseId,
    instructorId,
    req,
    requireEditable: true,
    attemptedAction: 'DELETE_UNIT',
  });
  const safeUnitId = toObjectId(unitId, 'unitId');

  const unit = await CourseUnit.findOne({ _id: safeUnitId, course_id: safeCourseId });
  if (!unit) {
    throw new AppError(404, 'UNIT_NOT_FOUND', 'Unit not found for this course.');
  }

  const contents = await CourseContent.find({ unit_id: safeUnitId });
  for (const content of contents) {
    if (content.storage_path) {
      // eslint-disable-next-line no-await-in-loop -- sequential cleanup, low volume per unit
      const fileId = content.storage_path.split('/').pop();
      // eslint-disable-next-line no-await-in-loop
      await fileStorage.safeDeleteFile({
        fileId,
        userId: safeInstructorId,
        actorRole: 'Instructor',
        req,
      });
    }
  }
  await CourseContent.deleteMany({ unit_id: safeUnitId });
  await unit.deleteOne();

  const remainingUnits = await CourseUnit.find({ course_id: safeCourseId }).sort({ order: 1 });
  await Promise.all(
    remainingUnits.map((u, index) => {
      u.order = index + 1;
      return u.save();
    })
  );

  let revertedToDraft = false;
  if (course.status === 'published') {
    revertedToDraft = await revertToDraftOnPublishedEdit({
      course,
      instructorId: safeInstructorId,
      changeType: 'UNIT_DELETED',
      changesSnapshot: { unit_id: safeUnitId.toString(), deleted_content_count: contents.length },
      req,
    });
    await course.save();
  }

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'COURSE_UNIT_DELETED',
    resourceType: 'CourseUnit',
    resourceId: safeUnitId.toString(),
    metadata: {
      course_id: safeCourseId,
      deleted_content_count: contents.length,
      reverted_to_draft: revertedToDraft,
    },
    req,
  });

  return { success: true, data: { deleted: true } };
}

/** Reorders ALL units of a course in one call. */
async function reorderUnits({ courseId, instructorId, orderedUnitIds, req }) {
  const { safeCourseId, safeInstructorId } = await loadOwnedCourse({
    courseId,
    instructorId,
    req,
    requireEditable: true,
    attemptedAction: 'REORDER_UNITS',
  });

  const existingUnits = await CourseUnit.find({ course_id: safeCourseId });
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
      CourseUnit.updateOne({ _id: toObjectId(unitId, 'unit_id') }, { order: index + 1 })
    )
  );

  const reorderedUnits = await CourseUnit.find({ course_id: safeCourseId })
    .sort({ order: 1 })
    .lean();

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'COURSE_UNITS_REORDERED',
    resourceType: 'Course',
    resourceId: safeCourseId.toString(),
    metadata: { new_order: orderedUnitIds },
    req,
  });

  return { success: true, data: { units: reorderedUnits } };
}

async function listUnitsForUser({ userId, role, courseId }) {
  const safeCourseId = toObjectId(courseId, 'courseId');
  const isStaff = role === 'Instructor' || ['Admin', 'SuperAdmin'].includes(role);

  const courseQuery = isStaff ? {} : { status: 'published' };
  const course = await Course.findOne({ _id: safeCourseId, ...courseQuery }).lean();
  if (!course) throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');

  if (
    role === 'Instructor' &&
    course.owner_instructor_id.toString() !== toObjectId(userId, 'userId').toString()
  ) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to view this course.');
  }

  const units = await CourseUnit.find({ course_id: safeCourseId })
    .select('_id title desc order')
    .sort({ order: 1 })
    .lean();

  return { success: true, data: { units } };
}

/** Enrolled-student progress overlay: completion flags + attendance status. */
async function buildEnrolledProgressExtras({ courseId, unitId, studentId, liveSessions = [] }) {
  const [completedContentIds, completedSessionIds] = await Promise.all([
    CourseProgressEvent.distinct('content_id', {
      course_id: courseId,
      student_id: studentId,
      unit_id: unitId,
      source_type: 'content',
    }),
    CourseProgressEvent.distinct('session_id', {
      course_id: courseId,
      student_id: studentId,
      unit_id: unitId,
      source_type: 'live_session',
    }),
  ]);

  let attendanceStatusMap = new Map();
  if (liveSessions.length > 0) {
    const attendanceRecords = await Attendance.find({
      sessionId: { $in: liveSessions.map((s) => s.session_id) },
      studentId,
    })
      .select('sessionId status')
      .lean();
    attendanceStatusMap = new Map(attendanceRecords.map((r) => [r.sessionId.toString(), r.status]));
  }

  return {
    completedSet: new Set(completedContentIds.map((id) => id.toString())),
    completedSessionSet: new Set(completedSessionIds.map((id) => id.toString())),
    attendanceStatusMap,
  };
}

/** Prev/next unit + total unit count, enrolled students only. */
async function buildNavigationExtras({ courseId, unitOrder }) {
  const [nextUnit, previousUnit, totalUnits] = await Promise.all([
    CourseUnit.findOne({ course_id: courseId, order: unitOrder + 1 })
      .select('_id title')
      .lean(),
    CourseUnit.findOne({ course_id: courseId, order: unitOrder - 1 })
      .select('_id title')
      .lean(),
    CourseUnit.countDocuments({ course_id: courseId }),
  ]);
  return {
    next_unit: nextUnit ? { _id: nextUnit._id, title: nextUnit.title } : null,
    previous_unit: previousUnit ? { _id: previousUnit._id, title: previousUnit.title } : null,
    total_units: totalUnits,
  };
}

async function getUnitDetails({ userId, role, courseId, unitId }) {
  const safeUserId = userId ? toObjectId(userId, 'userId') : null;
  const safeCourseId = toObjectId(courseId, 'courseId');
  const safeUnitId = toObjectId(unitId, 'unitId');
  const isStaff = role === 'Instructor' || ['Admin', 'SuperAdmin'].includes(role);

  const courseQuery = isStaff ? {} : { status: 'published' };
  const course = await Course.findOne({ _id: safeCourseId, ...courseQuery }).lean();
  if (!course) throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');

  const unit = await CourseUnit.findOne({ _id: safeUnitId, course_id: safeCourseId }).lean();
  if (!unit) throw new AppError(404, 'UNIT_NOT_FOUND', 'Unit not found for this course.');

  const content = await CourseContent.find({ unit_id: safeUnitId }).sort({ order: 1 }).lean();

  // --- authorization ---
  let isEnrolled = false;
  if (isStaff) {
    if (role === 'Instructor' && course.owner_instructor_id.toString() !== safeUserId.toString()) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have permission to view this course.');
    }
  } else {
    if (role === 'Student' && safeUserId) {
      const enrollment = await Enrollment.findOne({
        course_id: safeCourseId,
        student_id: safeUserId,
        status: { $in: ['active', 'completed'] },
      });
      isEnrolled = Boolean(enrollment);
    }
    if (!isEnrolled && unit.order !== 1) {
      throw new AppError(403, 'NOT_ENROLLED', 'Enroll in this course to access this unit.');
    }
  }

  // --- progress enrichment, enrolled students only ---
  let completedSet = new Set();
  let navigationExtras = {};

  if (isEnrolled) {
    // تمرير مصفوفة فارغة بدلاً من liveSessions لإلغاء تضمين الجلسات المباشرة
    ({ completedSet } = await buildEnrolledProgressExtras({
      courseId: safeCourseId,
      unitId: unit._id,
      studentId: safeUserId,
      liveSessions: [], // لا نريد جلسات مباشرة
    }));
    navigationExtras = await buildNavigationExtras({
      courseId: safeCourseId,
      unitOrder: unit.order,
    });
  }

  const formattedContent = content.map((c) => ({
    _id: c._id,
    content_type: c.content_type,
    title: c.title,
    desc: c.desc,
    order: c.order,
    content_data: c.content_data || null,
    download_url: c.storage_path ? `/api/v1/courses/${safeCourseId}/content/${c._id}/file` : null,
    mime_type: c.mime_type || null,
    size_bytes: c.size_bytes || null,
    ...(isEnrolled ? { completed: completedSet.has(c._id.toString()) } : {}),
  }));

  return {
    success: true,
    data: {
      unit: {
        ...unit,
        content: formattedContent,
        content_count: formattedContent.length,
        ...navigationExtras,
      },
      is_preview: !isEnrolled && !isStaff,
      ...(isEnrolled ? { course: { _id: course._id, title: course.title } } : {}),
    },
  };
}

module.exports = {
  addUnit,
  reorderUnits,
  deleteUnit,
  updateUnit,
  getUnitDetails,
  listUnitsForUser,
};
