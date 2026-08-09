// src/services/course/courseImage.service.js
const Course = require('../../models/Course');
const { AppError } = require('../../middleware/errorHandler');
const { assertCourseEditable } = require('./reviewState.service');
const { replaceImage } = require('../imageUpload.service');
const fileStorage = require('../fileStorage.service');
const { toObjectId } = require('../../utils/objectId.util');

/**
 * Sets/replaces a course's cover image.
 */
async function setCourseCoverImage({ courseId, instructorId, file, req }) {
  const safeCourseId = toObjectId(courseId, 'courseId');
  const safeInstructorId = toObjectId(instructorId, 'instructorId');

  const course = await Course.findById(safeCourseId);
  if (!course) {
    throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');
  }
  if (course.owner_instructor_id.toString() !== safeInstructorId.toString()) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have permission to modify this course.');
  }
  assertCourseEditable(course);

  const { storagePath } = await replaceImage({
    file,
    previousStoragePath: course.cover_image_storage_path,
    userId: safeInstructorId,
    actorRole: 'Instructor',
    req,
    metadata: { course_id: safeCourseId, purpose: 'course_cover_image' },
  });

  course.cover_image_storage_path = storagePath;
  await course.save();

  return { success: true, data: { course } };
}

/** Streams a course's cover image  */
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
