// src/services/course/progress.service.js
const Course = require('../../models/Course');
const CourseContent = require('../../models/CourseContent');
const CourseProgressEvent = require('../../models/CourseProgressEvent');
const Enrollment = require('../../models/Enrollment');
const { AppError } = require('../../middleware/errorHandler');
const auditService = require('../auditService');
const { toObjectId } = require('../../utils/objectId.util');

async function recordProgress({ studentId, courseId, contentId, req }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeCourseId = toObjectId(courseId, 'courseId');
  const safeContentId = toObjectId(contentId, 'contentId');

  const enrollment = await Enrollment.findOne({
    course_id: safeCourseId,
    student_id: safeStudentId,
    status: { $in: ['active', 'completed'] },
  });
  if (!enrollment) {
    throw new AppError(403, 'NOT_ENROLLED', 'You are not actively enrolled in this course.');
  }

  const content = await CourseContent.findOne({ _id: safeContentId, course_id: safeCourseId });
  if (!content) {
    throw new AppError(404, 'CONTENT_NOT_FOUND', 'Content item not found in this course.');
  }

  const idempotencyKey = `${safeStudentId.toString()}:${safeContentId.toString()}`;

  try {
    await CourseProgressEvent.create({
      course_id: safeCourseId,
      student_id: safeStudentId,
      unit_id: content.unit_id,
      content_id: safeContentId,
      event_type: content.content_type === 'video' ? 'video_completed' : 'lesson_completed',
      idempotency_key: idempotencyKey,
      source: 'server',
    });
  } catch (err) {
    if (err.code !== 11000) {
      throw err;
    }
  }

  const totalContentCount = await CourseContent.countDocuments({ course_id: safeCourseId });
  const distinctCompleted = await CourseProgressEvent.distinct('content_id', {
    course_id: safeCourseId,
    student_id: safeStudentId,
  });
  const completedCount = distinctCompleted.length;
  const progressPercentage = totalContentCount > 0 ? completedCount / totalContentCount : 0;

  const course = await Course.findById(safeCourseId).select('completion_threshold').lean();
  let justCompleted = false;
  if (progressPercentage >= (course?.completion_threshold ?? 1) && enrollment.status === 'active') {
    enrollment.status = 'completed';
    enrollment.completed_at = new Date();
    await enrollment.save();
    justCompleted = true;
  }

  await auditService.record({
    actorId: safeStudentId,
    actorRole: 'Student',
    action: 'COURSE_PROGRESS_RECORDED',
    resourceType: 'CourseProgressEvent',
    resourceId: safeContentId,
    metadata: {
      course_id: safeCourseId,
      progress_percentage: progressPercentage,
      course_completed: justCompleted,
    },
    req,
  });

  const courseCompleted = enrollment.status === 'completed';
  return {
    success: true,
    data: {
      progress_percentage: progressPercentage,
      completed_content_count: completedCount,
      total_content_count: totalContentCount,
      course_completed: courseCompleted,
    },
  };
}

module.exports = { recordProgress };
