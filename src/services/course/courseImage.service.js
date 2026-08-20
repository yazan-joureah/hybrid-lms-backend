// src/services/course/courseImage.service.js
const Course = require('../../models/Course');
const { AppError } = require('../../middleware/errorHandler');
const { replaceImage } = require('../imageUpload.service');
const fileStorage = require('../fileStorage.service');
const { toObjectId } = require('../../utils/objectId.util');
const { loadOwnedCourse } = require('./courseAccess.util');

async function setCourseCoverImage({ courseId, instructorId, file, req }) {
  const { course, safeInstructorId } = await loadOwnedCourse({
    courseId,
    instructorId,
    req,
    requireEditable: true,
    attemptedAction: 'SET_COVER_IMAGE',
  });

  const { storagePath } = await replaceImage({
    file,
    previousStoragePath: course.cover_image_storage_path,
    userId: safeInstructorId,
    actorRole: 'Instructor',
    req,
    metadata: { course_id: course._id, purpose: 'course_cover_image' },
  });

  course.cover_image_storage_path = storagePath;
  await course.save();

  return { success: true, data: { course } };
}

async function streamCourseCoverImage({ courseId }) {
  const safeCourseId = toObjectId(courseId, 'courseId');
  const course = await Course.findById(safeCourseId).select('cover_image_storage_path').lean();
  if (!course || !course.cover_image_storage_path) {
    throw new AppError(404, 'IMAGE_NOT_FOUND', 'No cover image set for this course.');
  }

  const fileId = course.cover_image_storage_path.split('/').pop();
  const { stream, contentType, filename } = await fileStorage.getDownloadStream({ fileId });
  return { stream, contentType, filename };
}

module.exports = { setCourseCoverImage, streamCourseCoverImage };
