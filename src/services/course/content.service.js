// src/services/course/content.service.js
const Course = require('../../models/Course');
const CourseUnit = require('../../models/CourseUnit');
const CourseContent = require('../../models/CourseContent');
const { AppError } = require('../../middleware/errorHandler');
const auditService = require('../auditService');
const { validateUploadedFile } = require('../../utils/fileValidation.util');
const fileStorage = require('../fileStorage.service');
const { assertCourseEditable, triggerReviewOnPublishedEdit } = require('./reviewState.service');
const { toObjectId } = require('../../utils/objectId.util');

// each module (COURSE , LIVE ) supplies its own allowed types/limit.
const COURSE_CONTENT_ALLOWED_MIME_TYPES = Object.freeze(['video/mp4', 'application/pdf']);
//Atlas M0 free-tier constraint
const COURSE_CONTENT_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

const FILE_BACKED_TYPES = ['video', 'document'];

/**
 * Adds a content item to a unit. video/document require a
 * validated file upload; link/text require content_data instead.
 */
async function addContent({ courseId, unitId, instructorId, contentType, file, contentData, req }) {
  const safeCourseId = toObjectId(courseId, 'courseId');
  const safeUnitId = toObjectId(unitId, 'unitId');
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
      metadata: { target_owner: course.owner_instructor_id, attempted_action: 'ADD_CONTENT' },
      req,
    });
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to modify this course.');
  }

  assertCourseEditable(course);

  const unit = await CourseUnit.findById(safeUnitId);
  if (!unit || !unit.course_id.equals(safeCourseId)) {
    throw new AppError(404, 'UNIT_NOT_FOUND', 'Unit not found for this course.');
  }

  let contentFields;

  if (FILE_BACKED_TYPES.includes(contentType)) {
    if (!file || !file.buffer) {
      throw new AppError(
        400,
        'FILE_REQUIRED',
        `A file is required for content_type '${contentType}'.`
      );
    }

    //Magic Bytes + size validation
    const validation = await validateUploadedFile(file.buffer, file.originalname, {
      allowedMimeTypes: COURSE_CONTENT_ALLOWED_MIME_TYPES,
      maxFileSizeBytes: COURSE_CONTENT_MAX_FILE_SIZE_BYTES,
    });
    if (!validation.valid) {
      throw new AppError(400, validation.reason, 'The uploaded file failed validation.');
    }

    const { storagePath } = await fileStorage.uploadFile({
      buffer: file.buffer,
      filename: file.originalname,
      mimeType: validation.detectedMime,
      sizeBytes: file.buffer.length,
      userId: safeInstructorId,
      actorRole: 'Instructor',
      req,
      metadata: { course_id: safeCourseId, unit_id: safeUnitId },
    });

    contentFields = {
      storage_path: storagePath,
      mime_type: validation.detectedMime,
      size_bytes: file.buffer.length,
      magic_bytes_match: true,
    };
  } else if (contentType === 'link') {
    if (!contentData?.url) {
      throw new AppError(
        400,
        'URL_REQUIRED',
        "content_data.url is required for content_type 'link'."
      );
    }
    contentFields = { content_data: { url: contentData.url } };
  } else if (contentType === 'text') {
    if (!contentData?.text) {
      throw new AppError(
        400,
        'TEXT_REQUIRED',
        "content_data.text is required for content_type 'text'."
      );
    }
    contentFields = { content_data: { text: contentData.text } };
  } else {
    throw new AppError(400, 'INVALID_CONTENT_TYPE', 'Unsupported content_type.');
  }

  // order is server-computed per unit, never trusted from the client
  const existingCount = await CourseContent.countDocuments({ unit_id: safeUnitId });

  const content = new CourseContent({
    course_id: safeCourseId,
    unit_id: safeUnitId,
    owner_instructor_id: safeInstructorId,
    content_type: contentType,
    order: existingCount + 1,
    ...contentFields,
  });
  await content.save();

  let reviewRequest = null;
  if (course.status === 'published') {
    reviewRequest = await triggerReviewOnPublishedEdit({
      course,
      safeInstructorId,
      changeType: 'CONTENT_ADDED',
      changesSnapshot: { content_id: content._id.toString(), content_type: contentType },
      req,
    });
    await course.save();
  }

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'COURSE_CONTENT_ADDED',
    resourceType: 'CourseContent',
    resourceId: content._id.toString(),
    metadata: {
      course_id: safeCourseId,
      unit_id: safeUnitId,
      content_type: contentType,
      review_request_id: reviewRequest?._id?.toString() || null,
    },
    req,
  });

  const unitContent = await CourseContent.find({ unit_id: unitId }).sort({ order: 1 }).lean();

  return { success: true, data: { content, unit_content: unitContent } };
}

async function deleteContent({ courseId, unitId, contentId, instructorId, req }) {
  const safeCourseId = toObjectId(courseId, 'courseId');
  const safeUnitId = toObjectId(unitId, 'unitId');
  const safeContentId = toObjectId(contentId, 'contentId');
  const safeInstructorId = toObjectId(instructorId, 'instructorId');

  const course = await Course.findById(safeCourseId);
  if (!course) throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');
  if (course.owner_instructor_id.toString() !== safeInstructorId.toString()) {
    throw new AppError(403, 'FORBIDDEN', 'Unauthorized course modification.');
  }
  assertCourseEditable(course);

  const content = await CourseContent.findOneAndDelete({
    _id: safeContentId,
    unit_id: safeUnitId,
    course_id: safeCourseId,
  });
  if (!content) throw new AppError(404, 'CONTENT_NOT_FOUND', 'Content item not found.');

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'CONTENT_DELETED',
    resourceType: 'CourseContent',
    resourceId: safeContentId.toString(),
    metadata: { unit_id: safeUnitId },
    req,
  });

  return { success: true, data: { message: 'Content item deleted successfully.' } };
}

async function reorderContent({ courseId, unitId, instructorId, contentOrders, req }) {
  // contentOrders: Array of { content_id: string, order: number }
  const safeCourseId = toObjectId(courseId, 'courseId');
  const safeUnitId = toObjectId(unitId, 'unitId');
  const safeInstructorId = toObjectId(instructorId, 'instructorId');

  const course = await Course.findById(safeCourseId);
  if (!course) throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');
  if (course.owner_instructor_id.toString() !== safeInstructorId.toString()) {
    throw new AppError(403, 'FORBIDDEN', 'Unauthorized course modification.');
  }
  assertCourseEditable(course);

  const bulkOps = contentOrders.map(({ content_id, order }) => ({
    updateOne: {
      filter: {
        _id: toObjectId(content_id, 'content_id'),
        unit_id: safeUnitId,
        course_id: safeCourseId,
      },
      update: { order },
    },
  }));

  await CourseContent.bulkWrite(bulkOps);

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'CONTENT_REORDERED',
    resourceType: 'CourseUnit',
    resourceId: safeUnitId.toString(),
    req,
  });

  return { success: true, data: { message: 'Content items reordered successfully.' } };
}

module.exports = { addContent, reorderContent, deleteContent };
