// src/services/course/progress.service.js
const Course = require('../models/Course');
const CourseContent = require('../models/CourseContent');
const LiveSession = require('../models/liveSession.model');
const Quiz = require('../models/quiz.model');
const QuizAttempt = require('../models/quizAttempt.model');
const CourseProgressEvent = require('../models/CourseProgressEvent');
const Enrollment = require('../models/Enrollment');
const { AppError } = require('../middleware/errorHandler');
const auditService = require('./auditService');
const { toObjectId } = require('../utils/objectId.util');

/** Computes the unified denominator/numerator: content + ended live sessions linked to a unit. */
async function getCompletionCounts({ courseId, studentId }) {
  const [totalContentCount, totalSessionCount, completedContentIds, completedSessionIds] =
    await Promise.all([
      CourseContent.countDocuments({ course_id: courseId }),
      LiveSession.countDocuments({ courseId, status: 'ended' }),
      CourseProgressEvent.distinct('content_id', {
        course_id: courseId,
        student_id: studentId,
        source_type: 'content',
      }),
      CourseProgressEvent.distinct('session_id', {
        course_id: courseId,
        student_id: studentId,
        source_type: 'live_session',
      }),
    ]);

  const totalCount = totalContentCount + totalSessionCount;
  const completedCount = completedContentIds.length + completedSessionIds.length;

  return {
    totalCount,
    completedCount,
    percentage: totalCount > 0 ? completedCount / totalCount : 0,
    totalContentCount,
    totalSessionCount,
  };
}

async function checkAllQuizzesPassed({ courseId, studentId, isSynchronous }) {
  const publishedQuizzes = await Quiz.find({ course_id: courseId, status: 'published' })
    .select('_id quiz_type')
    .lean();
  const publishedExam = publishedQuizzes.find((q) => q.quiz_type === 'exam');

  if (isSynchronous && !publishedExam) {
    return false;
  }
  if (publishedQuizzes.length === 0) return true;

  const quizIds = publishedQuizzes.map((q) => q._id);
  const passedQuizIds = await QuizAttempt.distinct('quiz_id', {
    quiz_id: { $in: quizIds },
    student_id: studentId,
    status: 'graded',
    passed: true,
  });
  const passedSet = new Set(passedQuizIds.map(String));
  return publishedQuizzes.every((q) => passedSet.has(String(q._id)));
}

async function checkAndMarkCompletion({ enrollment, courseId, percentage, studentId }) {
  if (enrollment.status !== 'active') return false;
  const course = await Course.findById(courseId)
    .select('completion_threshold is_synchronous')
    .lean();
  const percentageOk = percentage >= (course?.completion_threshold ?? 1);
  const quizzesOk = await checkAllQuizzesPassed({
    courseId,
    studentId,
    isSynchronous: Boolean(course?.is_synchronous),
  });
  if (percentageOk && quizzesOk) {
    enrollment.status = 'completed';
    enrollment.completed_at = new Date();
    await enrollment.save();
    return true;
  }
  return false;
}

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
      source_type: 'content',
      event_type: content.content_type === 'video' ? 'video_completed' : 'lesson_completed',
      idempotency_key: idempotencyKey,
      source: 'server',
    });
  } catch (err) {
    if (err.code !== 11000) throw err; // duplicate — idempotent, ignore
  }

  const { percentage, completedCount, totalContentCount } = await getCompletionCounts({
    courseId: safeCourseId,
    studentId: safeStudentId,
  });

  const justCompleted = await checkAndMarkCompletion({
    enrollment,
    courseId: safeCourseId,
    percentage,
    studentId: safeStudentId,
  });

  await auditService.record({
    actorId: safeStudentId,
    actorRole: 'Student',
    action: 'COURSE_PROGRESS_RECORDED',
    resourceType: 'CourseProgressEvent',
    resourceId: safeContentId,
    metadata: {
      course_id: safeCourseId,
      progress_percentage: percentage,
      course_completed: justCompleted,
    },
    req,
  });

  return {
    success: true,
    data: {
      progress_percentage: percentage,
      completed_content_count: completedCount,
      total_content_count: totalContentCount,
      course_completed: enrollment.status === 'completed',
    },
  };
}

async function getProgressSummary({ studentId, courseId }) {
  const enrollment = await Enrollment.findOne({
    course_id: courseId,
    student_id: studentId,
    status: { $in: ['active', 'completed'] },
  });
  if (!enrollment) {
    throw new AppError(403, 'NOT_ENROLLED', 'You are not enrolled in this course.');
  }

  const { percentage, completedCount, totalContentCount } = await getCompletionCounts({
    courseId,
    studentId,
  });
  const course = await Course.findById(courseId).select('completion_threshold').lean();

  return {
    success: true,
    data: {
      progress_percentage: percentage,
      completed_content_count: completedCount,
      total_content_count: totalContentCount,
      completion_threshold: course?.completion_threshold ?? null,
      enrollment_status: enrollment.status,
    },
  };
}

/** Live-session counterpart of recordProgress. */
async function recordLiveSessionCompletion({ studentId, courseId, unitId, sessionId, req }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeCourseId = toObjectId(courseId, 'courseId');
  const safeSessionId = toObjectId(sessionId, 'sessionId');

  const enrollment = await Enrollment.findOne({
    course_id: safeCourseId,
    student_id: safeStudentId,
    status: { $in: ['active', 'completed'] },
  });
  if (!enrollment) {
    return { success: true, data: { skipped: true, reason: 'NOT_ENROLLED' } };
  }

  const idempotencyKey = `${safeStudentId}:session:${safeSessionId}`;
  try {
    await CourseProgressEvent.create({
      course_id: safeCourseId,
      student_id: safeStudentId,
      unit_id: toObjectId(unitId, 'unitId'),
      session_id: safeSessionId,
      source_type: 'live_session',
      event_type: 'live_session_attended',
      idempotency_key: idempotencyKey,
      source: 'server',
    });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }

  const { percentage } = await getCompletionCounts({
    courseId: safeCourseId,
    studentId: safeStudentId,
  });
  const justCompleted = await checkAndMarkCompletion({
    enrollment,
    courseId: safeCourseId,
    percentage,
    studentId: safeStudentId,
  });

  await auditService.record({
    actorId: safeStudentId,
    actorRole: 'Student',
    action: 'LIVE_SESSION_PROGRESS_RECORDED',
    resourceType: 'CourseProgressEvent',
    resourceId: safeSessionId.toString(),
    metadata: {
      course_id: safeCourseId,
      progress_percentage: percentage,
      course_completed: justCompleted,
    },
    req,
  });

  return {
    success: true,
    data: { progress_percentage: percentage, course_completed: enrollment.status === 'completed' },
  };
}

module.exports = {
  recordProgress,
  getProgressSummary,
  getCompletionCounts,
  checkAndMarkCompletion,
  recordLiveSessionCompletion,
};
