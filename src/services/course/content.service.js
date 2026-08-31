// src/services/course/content.service.js
const Course = require('../../models/Course');
const CourseUnit = require('../../models/CourseUnit');
const CourseContent = require('../../models/CourseContent');
const Enrollment = require('../../models/Enrollment');
const { AppError } = require('../../middleware/errorHandler');
const auditService = require('../auditService');
const { validateUploadedFile } = require('../../utils/fileValidation.util');
const fileStorage = require('../fileStorage.service');
const { revertToDraftOnPublishedEdit } = require('./reviewState.service');
const { toObjectId } = require('../../utils/objectId.util');
const { loadOwnedCourse } = require('./courseAccess.util');
const { COURSE_CONTENT_POLICY } = require('../../config/uploadPolicies');

const FILE_BACKED_TYPES = ['video', 'document'];
const ADMIN_ROLES = ['Admin', 'SuperAdmin'];

async function addContent({
  courseId,
  unitId,
  instructorId,
  contentType,
  title,
  desc,
  file,
  contentData,
  req,
}) {
  const { course, safeCourseId, safeInstructorId } = await loadOwnedCourse({
    courseId,
    instructorId,
    req,
    requireEditable: true,
    attemptedAction: 'ADD_CONTENT',
  });
  const safeUnitId = toObjectId(unitId, 'unitId');

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
    const validation = await validateUploadedFile(
      file.buffer,
      file.originalname,
      COURSE_CONTENT_POLICY
    );
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
    if (!contentData?.url)
      throw new AppError(
        400,
        'URL_REQUIRED',
        "content_data.url is required for content_type 'link'."
      );
    contentFields = { content_data: { url: contentData.url } };
  } else if (contentType === 'text') {
    if (!contentData?.text)
      throw new AppError(
        400,
        'TEXT_REQUIRED',
        "content_data.text is required for content_type 'text'."
      );
    contentFields = { content_data: { text: contentData.text } };
  } else {
    throw new AppError(400, 'INVALID_CONTENT_TYPE', 'Unsupported content_type.');
  }

  const existingCount = await CourseContent.countDocuments({ unit_id: safeUnitId });
  const content = new CourseContent({
    course_id: safeCourseId,
    unit_id: safeUnitId,
    owner_instructor_id: safeInstructorId,
    content_type: contentType,
    title,
    desc: desc || '',
    order: existingCount + 1,
    ...contentFields,
  });
  await content.save();

  let revertedToDraft = false;
  if (course.status === 'published') {
    revertedToDraft = await revertToDraftOnPublishedEdit({
      course,
      instructorId: safeInstructorId,
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
      reverted_to_draft: revertedToDraft,
    },
    req,
  });

  const unitContent = await CourseContent.find({ unit_id: safeUnitId }).sort({ order: 1 }).lean();
  return { success: true, data: { content, unit_content: unitContent } };
}

async function updateContent({
  courseId,
  unitId,
  contentId,
  instructorId,
  title,
  desc,
  contentData,
  file,
  req,
}) {
  const { course, safeCourseId, safeInstructorId } = await loadOwnedCourse({
    courseId,
    instructorId,
    req,
    requireEditable: true,
    attemptedAction: 'UPDATE_CONTENT',
  });
  const safeUnitId = toObjectId(unitId, 'unitId');
  const safeContentId = toObjectId(contentId, 'contentId');

  const content = await CourseContent.findOne({
    _id: safeContentId,
    unit_id: safeUnitId,
    course_id: safeCourseId,
  });
  if (!content) throw new AppError(404, 'CONTENT_NOT_FOUND', 'Content item not found.');

  if (title !== undefined) content.title = title;
  if (desc !== undefined) content.desc = desc;
  if (content.content_type === 'link' && contentData?.url)
    content.content_data = { url: contentData.url };
  if (content.content_type === 'text' && contentData?.text)
    content.content_data = { text: contentData.text };

  if (file?.buffer && FILE_BACKED_TYPES.includes(content.content_type)) {
    const { storagePath, detectedMime, sizeBytes } = await fileStorage.replaceFile({
      file,
      previousStoragePath: content.storage_path,
      ...COURSE_CONTENT_POLICY,
      userId: safeInstructorId,
      actorRole: 'Instructor',
      req,
      metadata: { course_id: safeCourseId, unit_id: safeUnitId },
    });
    content.storage_path = storagePath;
    content.mime_type = detectedMime;
    content.size_bytes = sizeBytes;
  }

  await content.save();

  let revertedToDraft = false;
  if (course.status === 'published') {
    revertedToDraft = await revertToDraftOnPublishedEdit({
      course,
      instructorId: safeInstructorId,
      changeType: 'CONTENT_UPDATED',
      changesSnapshot: { content_id: safeContentId.toString() },
      req,
    });
    await course.save();
  }

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'CONTENT_UPDATED',
    resourceType: 'CourseContent',
    resourceId: safeContentId.toString(),
    metadata: {
      course_id: safeCourseId,
      unit_id: safeUnitId,
      reverted_to_draft: revertedToDraft,
    },
    req,
  });

  return { success: true, data: { content } };
}

async function deleteContent({ courseId, unitId, contentId, instructorId, req }) {
  const { safeCourseId, safeInstructorId } = await loadOwnedCourse({
    courseId,
    instructorId,
    req,
    requireEditable: true,
    attemptedAction: 'DELETE_CONTENT',
  });
  const safeUnitId = toObjectId(unitId, 'unitId');
  const safeContentId = toObjectId(contentId, 'contentId');

  const content = await CourseContent.findOneAndDelete({
    _id: safeContentId,
    unit_id: safeUnitId,
    course_id: safeCourseId,
  });
  if (!content) throw new AppError(404, 'CONTENT_NOT_FOUND', 'Content item not found.');

  if (content.storage_path) {
    const fileId = content.storage_path.split('/').pop();
    await fileStorage.safeDeleteFile({
      fileId,
      userId: safeInstructorId,
      actorRole: 'Instructor',
      req,
    });
  }

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

async function reorderContents({ courseId, unitId, instructorId, orderedContentIds, req }) {
  const { safeCourseId, safeInstructorId } = await loadOwnedCourse({
    courseId,
    instructorId,
    req,
    requireEditable: true,
    attemptedAction: 'REORDER_CONTENT',
  });
  const safeUnitId = toObjectId(unitId, 'unitId');

  const bulkOps = orderedContentIds.map((contentId, index) => ({
    updateOne: {
      filter: {
        _id: toObjectId(contentId, 'content_id'),
        unit_id: safeUnitId,
        course_id: safeCourseId,
      },
      update: { order: index + 1 },
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

  const content = await CourseContent.find({ unit_id: safeUnitId }).sort({ order: 1 }).lean();
  return { success: true, data: { content } };
}

// Streams a content item's file — ownership rule differs per role, kept separate from loadOwnedCourse.
async function streamContentFile({ userId, role, courseId, contentId }) {
  const safeUserId = toObjectId(userId, 'userId');
  const safeCourseId = toObjectId(courseId, 'courseId');
  const safeContentId = toObjectId(contentId, 'contentId');

  const course = await Course.findById(safeCourseId);
  if (!course) throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');

  if (role === 'Student') {
    const enrollment = await Enrollment.findOne({
      course_id: safeCourseId,
      student_id: safeUserId,
      status: { $in: ['active', 'completed'] },
    });
    if (!enrollment)
      throw new AppError(403, 'NOT_ENROLLED', 'You are not enrolled in this course.');
  } else if (role === 'Instructor') {
    if (course.owner_instructor_id.toString() !== safeUserId.toString()) {
      throw new AppError(403, 'FORBIDDEN', 'You are not the owner of this course.');
    }
  } else if (!ADMIN_ROLES.includes(role)) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to view this content.');
  }

  const content = await CourseContent.findOne({ _id: safeContentId, course_id: safeCourseId });
  if (!content || !content.storage_path) {
    throw new AppError(404, 'FILE_NOT_FOUND', 'File not found for this content item.');
  }

  const fileId = content.storage_path.split('/').pop();
  const { stream, contentType, filename } = await fileStorage.getDownloadStream({ fileId });
  return { stream, contentType: contentType || content.mime_type, filename };
}

module.exports = {
  addContent,
  updateContent,
  deleteContent,
  reorderContents,
  streamContentFile,
};
