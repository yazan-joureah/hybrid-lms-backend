// src/services/course/studentContent.service.js
/** Student-facing view of a course's structure (units + content), gated by active enrollment. */
const Enrollment = require('../../models/Enrollment');
const CourseUnit = require('../../models/CourseUnit');
const CourseContent = require('../../models/CourseContent');
const CourseProgressEvent = require('../../models/CourseProgressEvent');
const Course = require('../../models/Course');
const { AppError } = require('../../middleware/errorHandler');
const fileStorage = require('../fileStorage.service');
const { toObjectId } = require('../../utils/objectId.util');

/**
 * Returns the course outline for an enrolled student: units in order,
 * each with its content items marked completed/not, plus the overall
 * progress percentage in the same call.
 */
async function getCourseContentForStudent({ studentId, courseId }) {
  const enrollment = await Enrollment.findOne({
    course_id: courseId,
    student_id: studentId,
    status: { $in: ['active', 'completed'] },
  });
  if (!enrollment) {
    throw new AppError(403, 'NOT_ENROLLED', 'You are not enrolled in this course.');
  }

  const units = await CourseUnit.find({ course_id: courseId }).sort({ order: 1 }).lean();
  const unitIds = units.map((u) => u._id);
  const contents = await CourseContent.find({ unit_id: { $in: unitIds } })
    .sort({ order: 1 })
    .lean();

  const completedContentIds = await CourseProgressEvent.distinct('content_id', {
    course_id: courseId,
    student_id: studentId,
  });
  const completedSet = new Set(completedContentIds.map((id) => id.toString()));

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
      completed: completedSet.has(c._id.toString()),
    });
  });

  const outline = units.map((u) => ({
    _id: u._id,
    title: u.title,
    order: u.order,
    content: contentsByUnit.get(u._id.toString()) || [],
  }));

  const totalCount = contents.length;
  const completedCount = completedSet.size;

  return {
    success: true,
    data: {
      units: outline,
      progress_percentage: totalCount > 0 ? completedCount / totalCount : 0,
      completed_content_count: completedCount,
      total_content_count: totalCount,
    },
  };
}

/**
 * Resolves a content item's GridFS file and returns a live stream, after
 * verifying the requesting student has active/completed access to it.
 */
async function streamContentFile({ studentId, courseId, contentId }) {
  const enrollment = await Enrollment.findOne({
    course_id: courseId,
    student_id: studentId,
    status: { $in: ['active', 'completed'] },
  });
  if (!enrollment) {
    throw new AppError(403, 'NOT_ENROLLED', 'You are not enrolled in this course.');
  }

  const content = await CourseContent.findOne({ _id: contentId, course_id: courseId });
  if (!content || !content.storage_path) {
    throw new AppError(404, 'FILE_NOT_FOUND', 'File not found for this content item.');
  }

  const fileId = content.storage_path.split('/').pop();
  const { stream, contentType, filename } = await fileStorage.getDownloadStream({ fileId });

  return { stream, contentType: contentType || content.mime_type, filename };
}

/**
 * Lightweight progress summary — for dashboards/cards that only need the
 * number, not the full course outline (avoids over-fetching).
 */
async function getProgressSummary({ studentId, courseId }) {
  const enrollment = await Enrollment.findOne({
    course_id: courseId,
    student_id: studentId,
    status: { $in: ['active', 'completed'] },
  });
  if (!enrollment) {
    throw new AppError(403, 'NOT_ENROLLED', 'You are not enrolled in this course.');
  }

  const [totalCount, completedContentIds, course] = await Promise.all([
    CourseContent.countDocuments({ course_id: courseId }),
    CourseProgressEvent.distinct('content_id', { course_id: courseId, student_id: studentId }),
    Course.findById(courseId).select('completion_threshold').lean(),
  ]);

  const completedCount = completedContentIds.length;
  const percentage = totalCount > 0 ? completedCount / totalCount : 0;

  return {
    success: true,
    data: {
      progress_percentage: percentage,
      completed_content_count: completedCount,
      total_content_count: totalCount,
      completion_threshold: course?.completion_threshold ?? null,
      enrollment_status: enrollment.status,
    },
  };
}

/**
 * Streams content file for an instructor who owns the course.
 * No enrollment check – only ownership verification.
 */
async function streamContentFileForInstructor({ instructorId, courseId, contentId }) {
  const course = await Course.findById(courseId);
  if (!course) {
    throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');
  }

  if (course.owner_instructor_id.toString() !== instructorId) {
    throw new AppError(403, 'FORBIDDEN', 'You are not the owner of this course.');
  }

  // 3. Fetch content
  const content = await CourseContent.findOne({ _id: contentId, course_id: courseId });
  if (!content || !content.storage_path) {
    throw new AppError(404, 'FILE_NOT_FOUND', 'File not found for this content item.');
  }

  // 4. Get file stream from storage
  const fileId = content.storage_path.split('/').pop();
  const { stream, contentType, filename } = await fileStorage.getDownloadStream({ fileId });

  return { stream, contentType: contentType || content.mime_type, filename };
}

/**
 * Student-specific wrapper: Fetches a single unit with progress tracking.
 * Enforces enrollment check and adds progress enrichment.
 */
async function getUnitDetailsForStudent({ studentId, courseId, unitId }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeCourseId = toObjectId(courseId, 'courseId');

  // Import core function from unit.service
  const { _getUnitDetailsCore } = require('./unit.service');

  // Fetch core data (checks course exists and is published)
  const { course, unit, content } = await _getUnitDetailsCore({
    courseId,
    unitId,
    courseQuery: { status: 'published' }, // Students can only access published courses
  });

  // Authorization: enrollment check after verifying course exists
  const enrollment = await Enrollment.findOne({
    course_id: safeCourseId,
    student_id: safeStudentId,
    status: { $in: ['active', 'completed'] },
  });
  if (!enrollment) {
    throw new AppError(403, 'NOT_ENROLLED', 'You are not enrolled in this course.');
  }

  // Get completed content IDs for progress tracking
  const completedContentIds = await CourseProgressEvent.distinct('content_id', {
    course_id: safeCourseId,
    student_id: safeStudentId,
    unit_id: unit._id,
  });
  const completedSet = new Set(completedContentIds.map((id) => id.toString()));

  // Format content with progress tracking
  const formattedContent = content.map((c) => ({
    _id: c._id,
    content_type: c.content_type,
    order: c.order,
    content_data: c.content_data || null,
    download_url: c.storage_path ? `/api/v1/courses/${safeCourseId}/content/${c._id}/file` : null,
    mime_type: c.mime_type || null,
    size_bytes: c.size_bytes || null,
    completed: completedSet.has(c._id.toString()),
  }));

  // Get navigation (next/previous unit)
  const [nextUnit, previousUnit, totalUnits] = await Promise.all([
    CourseUnit.findOne({ course_id: safeCourseId, order: unit.order + 1 })
      .select('_id title')
      .lean(),
    CourseUnit.findOne({ course_id: safeCourseId, order: unit.order - 1 })
      .select('_id title')
      .lean(),
    CourseUnit.countDocuments({ course_id: safeCourseId }),
  ]);

  // Calculate unit-level progress
  const completedCount = formattedContent.filter((c) => c.completed).length;
  const unitProgress = formattedContent.length > 0 ? completedCount / formattedContent.length : 0;

  return {
    success: true,
    data: {
      unit: {
        ...unit,
        content: formattedContent,
        content_count: formattedContent.length,
        completed_count: completedCount,
        unit_progress: unitProgress,
        next_unit: nextUnit ? { _id: nextUnit._id, title: nextUnit.title } : null,
        previous_unit: previousUnit ? { _id: previousUnit._id, title: previousUnit.title } : null,
      },
      course: {
        _id: course._id,
        title: course.title,
        total_units: totalUnits,
      },
    },
  };
}

module.exports = {
  getCourseContentForStudent,
  streamContentFile,
  getProgressSummary,
  streamContentFileForInstructor,
  getUnitDetailsForStudent,
};
