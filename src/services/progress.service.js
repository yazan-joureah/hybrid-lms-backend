// src/services/course/progress.service.js
const Course = require('../models/Course');
const CourseContent = require('../models/CourseContent');
const LiveSession = require('../models/liveSession.model');
const Quiz = require('../models/quiz.model');
const QuizAttempt = require('../models/quizAttempt.model');
const PeerAssignment = require('../models/peerAssignment.model');
const PeerSubmission = require('../models/peerSubmission.model');
const PeerReview = require('../models/peerReview.model');
const CourseProgressEvent = require('../models/CourseProgressEvent');
const Enrollment = require('../models/Enrollment');
const { AppError } = require('../middleware/errorHandler');
const auditService = require('./auditService');
const { toObjectId } = require('../utils/objectId.util');

/**
 * Computes the unified denominator/numerator: content + ended live sessions
 * + due peer assignments.
 *
 * PEER assignments are included in the denominator only if status !== 'open'
 * (i.e., distributed or completed) – same principle as LiveSession(status:'ended'):
 * an assignment that is not yet "due" in time/state is not counted.
 */
async function getCompletionCounts({ courseId, studentId }) {
  const [
    totalContentCount,
    totalSessionCount,
    duePeerAssignmentIds,
    completedContentIds,
    completedSessionIds,
    completedPeerAssignmentIds,
  ] = await Promise.all([
    CourseContent.countDocuments({ course_id: courseId }),
    LiveSession.countDocuments({ courseId, status: 'ended' }),
    PeerAssignment.distinct('_id', { courseId }),
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
    CourseProgressEvent.distinct('peer_assignment_id', {
      course_id: courseId,
      student_id: studentId,
      source_type: 'peer_assignment',
    }),
  ]);

  const totalPeerCount = duePeerAssignmentIds.length;
  const totalCount = totalContentCount + totalSessionCount + totalPeerCount;
  const completedCount =
    completedContentIds.length + completedSessionIds.length + completedPeerAssignmentIds.length;

  return {
    totalCount,
    completedCount,
    percentage: totalCount > 0 ? completedCount / totalCount : 0,
    totalContentCount,
    totalSessionCount,
    totalPeerCount,
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
  const safeUnitId = unitId ? toObjectId(unitId, 'unitId') : null;

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
      unit_id: safeUnitId,
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

/**
 * Peer-assignment counterpart of recordProgress/recordLiveSessionCompletion.
 *
 * forceFinal=true (يُستدعى من grading.service.js بعد calculateFinalGrades أو
 * overrideSubmissionGrade): يتجاوز شرط الـ threshold الأصلي طالما فيه درجة فعلية
 * واحدة على الأقل — لأن التقييم أصبح نهائياً ولن تصل مراجعات إضافية بعد الآن.
 */
async function checkAndRecordPeerSubmissionCompletion({ submissionId, req, forceFinal = false }) {
  const submission = await PeerSubmission.findById(submissionId);
  if (!submission)
    return { success: true, data: { skipped: true, reason: 'SUBMISSION_NOT_FOUND' } };

  const assignment = await PeerAssignment.findById(submission.assignmentId).select('unitId').lean();

  const enrollment = await Enrollment.findOne({
    course_id: submission.courseId,
    student_id: submission.studentId,
    status: { $in: ['active', 'completed'] },
  });
  if (!enrollment) {
    return { success: true, data: { skipped: true, reason: 'NOT_ENROLLED' } };
  }

  const allAssignedReviews = await PeerReview.find({
    submissionId,
    attemptNumber: submission.attemptNumber,
  })
    .select('status totalScore')
    .lean();

  const completedCount = allAssignedReviews.filter((r) => r.status === 'completed').length;
  const threshold = Math.min(3, allAssignedReviews.length);

  if (!forceFinal && (threshold === 0 || completedCount < threshold)) {
    return { success: true, data: { skipped: true, reason: 'REVIEWS_INCOMPLETE' } };
  }
  if (forceFinal && completedCount === 0) {
    return { success: true, data: { skipped: true, reason: 'NO_GRADE_TO_CREDIT' } };
  }

  if (!submission.gradeOverridden) {
    const completedReviews = allAssignedReviews.filter((r) => r.status === 'completed');
    if (completedReviews.length > 0) {
      const scores = completedReviews.map((r) => r.totalScore).filter((s) => typeof s === 'number');
      if (scores.length > 0) {
        const average = scores.reduce((sum, s) => sum + s, 0) / scores.length;
        const maxScore = Math.max(...scores);
        const minScore = Math.min(...scores);
        const variance = maxScore - minScore;
        const flagged = variance > 20;

        submission.finalScore = Math.round(average * 100) / 100;
        submission.finalScorePercentage = Math.round(average * 100) / 100;
        submission.gradingFlagged = flagged;
        submission.gradingFlagReason = flagged ? 'REVIEWER_VARIANCE_EXCEEDS_THRESHOLD' : null;
        await submission.save();
      }
    } else if (forceFinal) {
      submission.gradingFlagged = true;
      submission.gradingFlagReason = 'NO_REVIEWER_COMPLETED';
      await submission.save();
    }
  }

  const idempotencyKey = `${submission.studentId}:peer:${submission.assignmentId}`;
  try {
    await CourseProgressEvent.create({
      course_id: submission.courseId,
      student_id: submission.studentId,
      unit_id: assignment?.unitId || null,
      peer_assignment_id: submission.assignmentId,
      source_type: 'peer_assignment',
      event_type: 'peer_assignment_completed',
      idempotency_key: idempotencyKey,
      source: 'server',
    });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }

  const { percentage } = await getCompletionCounts({
    courseId: submission.courseId,
    studentId: submission.studentId,
  });
  const justCompleted = await checkAndMarkCompletion({
    enrollment,
    courseId: submission.courseId,
    percentage,
    studentId: submission.studentId,
  });

  await auditService.record({
    actorId: submission.studentId,
    actorRole: 'Student',
    action: 'PEER_ASSIGNMENT_PROGRESS_RECORDED',
    resourceType: 'CourseProgressEvent',
    resourceId: submission.assignmentId.toString(),
    metadata: {
      course_id: submission.courseId,
      progress_percentage: percentage,
      course_completed: justCompleted,
      reviews_received: completedCount,
      threshold_applied: threshold,
      forced: forceFinal,
      auto_graded_score: submission.finalScorePercentage,
    },
    req,
  });

  return {
    success: true,
    data: {
      progress_percentage: percentage,
      course_completed: enrollment.status === 'completed',
      finalScorePercentage: submission.finalScorePercentage,
    },
  };
}

module.exports = {
  recordProgress,
  getProgressSummary,
  getCompletionCounts,
  checkAndMarkCompletion,
  recordLiveSessionCompletion,
  checkAndRecordPeerSubmissionCompletion,
};
