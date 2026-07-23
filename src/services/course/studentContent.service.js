// src/services/course/studentContent.service.js
const Enrollment = require('../../models/Enrollment');
const CourseUnit = require('../../models/CourseUnit');
const CourseContent = require('../../models/CourseContent');
const { AppError } = require('../../middleware/errorHandler');
const fileStorage = require('../fileStorage.service');
const { toObjectId } = require('../../utils/objectId.util');

/**
 * Returns the course outline for an enrolled student: units in order,
 * each with its content items.
 */
async function getCourseContentForStudent({ studentId, courseId }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeCourseId = toObjectId(courseId, 'courseId');

  const enrollment = await Enrollment.findOne({
    course_id: safeCourseId,
    student_id: safeStudentId,
    status: { $in: ['active', 'completed'] },
  });
  if (!enrollment) {
    throw new AppError(403, 'NOT_ENROLLED', 'You are not enrolled in this course.');
  }

  const units = await CourseUnit.find({ course_id: safeCourseId }).sort({ order: 1 }).lean();
  const unitIds = units.map((u) => u._id);
  const contents = await CourseContent.find({ unit_id: { $in: unitIds } })
    .sort({ order: 1 })
    .lean();

  const contentsByUnit = new Map();
  contents.forEach((c) => {
    const key = c.unit_id.toString();
    if (!contentsByUnit.has(key)) contentsByUnit.set(key, []);

    const isFileBacked = c.storage_path != null;
    contentsByUnit.get(key).push({
      _id: c._id,
      content_type: c.content_type,
      order: c.order,
      content_data: c.content_data || null,
      download_url: isFileBacked ? `/api/v1/courses/${courseId}/content/${c._id}/file` : null,
      mime_type: c.mime_type || null,
    });
  });

  const outline = units.map((u) => ({
    _id: u._id,
    title: u.title,
    order: u.order,
    content: contentsByUnit.get(u._id.toString()) || [],
  }));

  return { success: true, data: { units: outline } };
}

/**
 * Resolves a content item's GridFS file and returns a live stream, after
 * verifying the requesting student has active/completed access to it.
 */
async function streamContentFile({ studentId, courseId, contentId }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeCourseId = toObjectId(courseId, 'courseId');
  const safeContentId = toObjectId(contentId, 'contentId');

  const enrollment = await Enrollment.findOne({
    course_id: safeCourseId,
    student_id: safeStudentId,
    status: { $in: ['active', 'completed'] },
  });
  if (!enrollment) {
    throw new AppError(403, 'NOT_ENROLLED', 'You are not enrolled in this course.');
  }

  const content = await CourseContent.findOne({ _id: safeContentId, course_id: safeCourseId });
  if (!content || !content.storage_path) {
    throw new AppError(404, 'FILE_NOT_FOUND', 'File not found for this content item.');
  }

  // storage_path format: gridfs://course_files/<objectId> — parse the trailing ID
  const fileId = content.storage_path.split('/').pop();
  const { stream, contentType, filename } = await fileStorage.getDownloadStream({ fileId });

  return { stream, contentType: contentType || content.mime_type, filename };
}

module.exports = { getCourseContentForStudent, streamContentFile };
