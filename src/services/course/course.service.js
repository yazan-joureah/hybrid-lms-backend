// src/services/course/course.service.js
const Course = require('../../models/Course');
const User = require('../../models/User');
const CourseUnit = require('../../models/CourseUnit');
const CourseContent = require('../../models/CourseContent');
const fileStorage = require('../fileStorage.service');
const CourseReviewRequest = require('../../models/CourseReviewRequest');
const Quiz = require('../../models/quiz.model');
const LiveSession = require('../../models/liveSession.model');
const Attendance = require('../../models/attendance.model');
const PeerAssignment = require('../../models/peerAssignment.model');
const PeerSubmission = require('../../models/peerSubmission.model');
const PeerReview = require('../../models/peerReview.model');
const auditService = require('../auditService');
const { AppError } = require('../../middleware/errorHandler');
const { revertToDraftOnPublishedEdit } = require('./reviewState.service');
const { toObjectId } = require('../../utils/objectId.util');
const { loadOwnedCourse, paginateQuery } = require('./courseAccess.util');

// Creates a new course in 'draft' status.
async function createCourse({ instructorId, courseData, req }) {
  const safeInstructorId = toObjectId(instructorId, 'instructorId');
  const instructor = await User.findById(safeInstructorId);
  if (!instructor) {
    throw new AppError(404, 'INSTRUCTOR_NOT_FOUND', 'Instructor account does not exist.');
  }

  const newCourse = new Course({
    ...courseData,
    owner_instructor_id: safeInstructorId,
    status: 'draft',
    content_complete: false,
    published_at: null,
  });
  await newCourse.save();

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: instructor.role,
    action: 'COURSE_CREATED',
    resourceType: 'Course',
    resourceId: newCourse._id.toString(),
    metadata: { title: newCourse.title, course_type: newCourse.course_type },
    req,
  });

  return { success: true, data: { course: newCourse } };
}

async function getInstructorCourses({ instructorId, queryParams = {} }) {
  const safeInstructorId = toObjectId(instructorId, 'instructorId');
  const { records: courses, meta } = await paginateQuery({
    model: Course,
    query: { owner_instructor_id: safeInstructorId },
    queryParams,
    sort: { updatedAt: -1 },
  });
  return { success: true, data: { courses, meta } };
}

/**
 * Updates an existing course. Blocks all edits while pending_review;
 * re-triggers review if a sensitive field changes on a published course.
 */
async function updateCourse({ courseId, instructorId, updateData, req }) {
  const { course, safeCourseId, safeInstructorId } = await loadOwnedCourse({
    courseId,
    instructorId,
    req,
    requireEditable: true,
    attemptedAction: 'UPDATE_COURSE',
  });

  const sensitiveFields = ['title', 'description', 'price', 'course_type', 'is_synchronous'];
  let sensitiveChangeDetected = false;
  const changesSnapshot = { before: {}, after: {} };

  sensitiveFields.forEach((field) => {
    if (updateData[field] !== undefined && updateData[field] !== course[field]) {
      sensitiveChangeDetected = true;
      changesSnapshot.before[field] = course[field];
      changesSnapshot.after[field] = updateData[field];
    }
  });

  let revertedToDraft = false;
  if (sensitiveChangeDetected) {
    revertedToDraft = await revertToDraftOnPublishedEdit({
      course,
      instructorId: safeInstructorId,
      changeType: 'FIELDS_UPDATED',
      changesSnapshot,
      req,
    });
  }

  Object.assign(course, updateData);
  await course.save(); // حفظ واحد فقط الآن — لا حاجة لحفظَين منفصلَين

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'COURSE_UPDATED',
    resourceType: 'Course',
    resourceId: safeCourseId,
    metadata: {
      status_changed_to: course.status,
      sensitive_change: sensitiveChangeDetected,
      changes: changesSnapshot,
      reverted_to_draft: revertedToDraft, // بدل review_request_id
    },
    req,
  });

  return { success: true, data: { course } };
}

async function assertPublishedExamExists(courseId) {
  const exam = await Quiz.findOne({
    course_id: courseId,
    quiz_type: 'exam',
    status: 'published',
  }).lean();

  if (!exam) {
    throw new AppError(
      400,
      'EXAM_REQUIRED',
      'You must create and publish a final exam before submitting this course for review.'
    );
  }
}

/**
 * Submits a course for admin review. At least one CourseContent item must
 * exist — an empty course cannot be submitted.
 */
async function submitCourseForReview({ courseId, instructorId, req }) {
  const { course, safeCourseId, safeInstructorId } = await loadOwnedCourse({
    courseId,
    instructorId,
    req,
    attemptedAction: 'SUBMIT_REVIEW',
  });

  if (course.status === 'pending_review') {
    throw new AppError(400, 'ALREADY_PENDING', 'Course is already pending review.');
  }
  if (course.status === 'published') {
    throw new AppError(400, 'ALREADY_PUBLISHED', 'Course is already published.');
  }

  const contentCount = await CourseContent.countDocuments({ course_id: safeCourseId });
  if (contentCount === 0) {
    throw new AppError(
      400,
      'COURSE_CONTENT_INCOMPLETE',
      'Course must have at least one content item before submission.'
    );
  }

  await assertPublishedExamExists(safeCourseId);

  const reviewRequest = new CourseReviewRequest({
    course_id: course._id,
    requested_by: safeInstructorId,
    status: 'pending_review',
    changes_snapshot: course.toObject(),
  });
  await reviewRequest.save();

  course.status = 'pending_review';
  course.content_complete = true;
  await course.save();

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'COURSE_SUBMITTED_FOR_REVIEW',
    resourceType: 'CourseReviewRequest',
    resourceId: reviewRequest._id.toString(),
    metadata: { course_id: course._id.toString() },
    req,
  });

  return { success: true, data: { reviewRequest } };
}

// Deletes a course entirely
async function deleteCourse({ courseId, instructorId, req }) {
  const { safeCourseId, safeInstructorId, course } = await loadOwnedCourse({
    courseId,
    instructorId,
    req,
    attemptedAction: 'DELETE_COURSE',
  });

  if (!['draft', 'rejected'].includes(course.status)) {
    throw new AppError(
      409,
      'COURSE_NOT_DELETABLE',
      'Only draft or rejected courses can be deleted.'
    );
  }

  if (course.published_at) {
    throw new AppError(
      409,
      'COURSE_HAS_PUBLICATION_HISTORY',
      'This course has publication history and cannot be deleted — archive it instead.'
    );
  }

  const units = await CourseUnit.find({ course_id: safeCourseId });
  const unitIds = units.map((u) => u._id);
  const contents = await CourseContent.find({ unit_id: { $in: unitIds } });

  for (const content of contents) {
    if (content.storage_path) {
      // eslint-disable-next-line no-await-in-loop
      const fileId = content.storage_path.split('/').pop();
      // eslint-disable-next-line no-await-in-loop
      await fileStorage.safeDeleteFile({
        fileId,
        userId: safeInstructorId,
        actorRole: 'Instructor',
        req,
      });
    }
  }

  await CourseContent.deleteMany({ unit_id: { $in: unitIds } });
  await CourseUnit.deleteMany({ course_id: safeCourseId });
  const deletedQuizzes = await Quiz.deleteMany({ course_id: safeCourseId });

  const liveSessions = await LiveSession.find({ courseId: safeCourseId }).select('_id');
  const sessionIds = liveSessions.map((s) => s._id);
  const deletedAttendance = await Attendance.deleteMany({ sessionId: { $in: sessionIds } });
  const deletedSessions = await LiveSession.deleteMany({ courseId: safeCourseId });

  const assignments = await PeerAssignment.find({ courseId: safeCourseId }).select('_id');
  const assignmentIds = assignments.map((a) => a._id);
  const submissions = await PeerSubmission.find({ assignmentId: { $in: assignmentIds } });

  for (const submission of submissions) {
    if (submission.fileId) {
      // eslint-disable-next-line no-await-in-loop
      await fileStorage.safeDeleteFile({
        fileId: submission.fileId,
        userId: safeInstructorId,
        actorRole: 'Instructor',
        req,
      });
    }
  }
  const submissionIds = submissions.map((s) => s._id);
  const deletedReviews = await PeerReview.deleteMany({ submissionId: { $in: submissionIds } });
  const deletedSubmissions = await PeerSubmission.deleteMany({
    assignmentId: { $in: assignmentIds },
  });
  const deletedAssignments = await PeerAssignment.deleteMany({ courseId: safeCourseId });

  // --- سجلات مراجعة تاريخية (rejected/cancelled فقط، بحكم حارس published_at)
  const deletedReviewRequests = await CourseReviewRequest.deleteMany({
    course_id: safeCourseId,
  });

  await course.deleteOne();

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'COURSE_DELETED',
    resourceType: 'Course',
    resourceId: safeCourseId.toString(),
    metadata: {
      deleted_units: units.length,
      deleted_content: contents.length,
      deleted_quizzes: deletedQuizzes.deletedCount,
      deleted_live_sessions: deletedSessions.deletedCount,
      deleted_attendance_records: deletedAttendance.deletedCount,
      deleted_peer_assignments: deletedAssignments.deletedCount,
      deleted_peer_submissions: deletedSubmissions.deletedCount,
      deleted_peer_reviews: deletedReviews.deletedCount,
      deleted_review_requests: deletedReviewRequests.deletedCount,
    },
    req,
  });

  return { success: true, data: { deleted: true } };
}

async function getCourseForUser({ userId, role, courseId }) {
  const safeCourseId = toObjectId(courseId, 'courseId');

  if (role === 'Instructor' || ['Admin', 'SuperAdmin'].includes(role)) {
    const course = await Course.findById(safeCourseId).lean();
    if (!course) throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');

    if (
      role === 'Instructor' &&
      course.owner_instructor_id.toString() !== toObjectId(userId, 'userId').toString()
    ) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have permission to view this course.');
    }
    return { success: true, data: { course } };
  }

  // Guest or Student: published only, 404 otherwise (prevents enumeration)
  const course = await Course.findOne({ _id: safeCourseId, status: 'published' })
    .select('-rejection_reason -suspended_by')
    .lean();
  if (!course) throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');

  return { success: true, data: { course } };
}

module.exports = {
  createCourse,
  getInstructorCourses,
  updateCourse,
  submitCourseForReview,
  deleteCourse,
  getCourseForUser,
  assertPublishedExamExists,
};
