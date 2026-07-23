// src/services/course/progress.service.js
const Course = require('../../models/Course');
const CourseContent = require('../../models/CourseContent');
const CourseProgressEvent = require('../../models/CourseProgressEvent');
const Enrollment = require('../../models/Enrollment');
const { AppError } = require('../../middleware/errorHandler');
const auditService = require('../auditService');

/**
 * records a single content-completion event and returns the
 * recomputed course progress percentage.
 * SECURITY: the client sends ONLY a content_id — no percentage, no
 * completion count. The percentage below is always derived server-side
 * from actually-recorded events.
 */
async function recordProgress({ studentId, courseId, contentId, req }) {
  const enrollment = await Enrollment.findOne({
    course_id: courseId,
    student_id: studentId,
    status: { $in: ['active', 'completed'] },
  });
  if (!enrollment) {
    throw new AppError(403, 'NOT_ENROLLED', 'You are not actively enrolled in this course.');
  }

  const content = await CourseContent.findOne({ _id: contentId, course_id: courseId });
  if (!content) {
    throw new AppError(404, 'CONTENT_NOT_FOUND', 'Content item not found in this course.');
  }

  // SECURITY/DEVIATION: deterministic idempotency key (studentId:contentId)
  // relies on the DB-level unique index as the real guarantee against
  // duplicate/racing submissions
  const idempotencyKey = `${studentId}:${contentId}`;

  try {
    await CourseProgressEvent.create({
      course_id: courseId,
      student_id: studentId,
      unit_id: content.unit_id,
      content_id: contentId,
      event_type: content.content_type === 'video' ? 'video_completed' : 'lesson_completed',
      idempotency_key: idempotencyKey,
      source: 'server',
    });
  } catch (err) {
    if (err.code !== 11000) {
      throw err;
    }
  }

  // Server-side recomputation
  const totalContentCount = await CourseContent.countDocuments({ course_id: courseId });
  const distinctCompleted = await CourseProgressEvent.distinct('content_id', {
    course_id: courseId,
    student_id: studentId,
  });
  const completedCount = distinctCompleted.length;
  const progressPercentage = totalContentCount > 0 ? completedCount / totalContentCount : 0;

  const course = await Course.findById(courseId).select('completion_threshold').lean();
  let justCompleted = false;
  if (progressPercentage >= (course?.completion_threshold ?? 1) && enrollment.status === 'active') {
    enrollment.status = 'completed';
    enrollment.completed_at = new Date();
    await enrollment.save();
    justCompleted = true;
  }

  await auditService.record({
    actorId: studentId,
    actorRole: 'Student',
    action: 'COURSE_PROGRESS_RECORDED',
    resourceType: 'CourseProgressEvent',
    resourceId: contentId,
    metadata: {
      course_id: courseId,
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
