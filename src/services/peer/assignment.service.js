// src/services/peer/assignment.service.js
// UC-PEER-01 — Create Peer Assessment Task

const PeerAssignment = require('../../models/peerAssignment.model');
const Course = require('../../models/Course');
const Enrollment = require('../../models/Enrollment');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');
const auditService = require('../auditService');

/** يتحقق أن المحاضر يملك الكورس فعلياً — نفس نمط LIVE/COURSE */
async function assertInstructorOwnsCourse({ instructorId, courseId, req }) {
  const course = await Course.findById(courseId);
  if (!course) {
    throw new AppError(404, 'COURSE_NOT_FOUND', 'الكورس غير موجود.');
  }
  if (course.owner_instructor_id.toString() !== instructorId.toString()) {
    await auditService.record({
      actorId: instructorId,
      actorRole: 'Instructor',
      action: 'UNAUTHORIZED_PEER_ASSIGNMENT_ACCESS_ATTEMPT',
      resourceType: 'Course',
      resourceId: courseId.toString(),
      metadata: { target_owner: course.owner_instructor_id },
      req,
    });
    throw new AppError(403, 'FORBIDDEN', 'لا تملك صلاحية إدارة هذا الكورس.');
  }
  return course;
}

/**
 * UC-PEER-01 — إنشاء مهمة تقييم أقران جديدة
 */
async function createAssignment({ instructorId, assignmentData, req }) {
  const safeInstructorId = toObjectId(instructorId, 'instructorId');
  const safeCourseId = toObjectId(assignmentData.courseId, 'courseId');

  await assertInstructorOwnsCourse({ instructorId: safeInstructorId, courseId: safeCourseId, req });

  const submissionDeadline = new Date(assignmentData.submissionDeadline);
  const reviewDeadline = new Date(assignmentData.reviewDeadline);
  const now = new Date();

  if (submissionDeadline <= now) {
    throw new AppError(400, 'INVALID_SUBMISSION_DEADLINE', 'يجب أن يكون موعد التسليم في المستقبل.');
  }
  // [a4] "مهلة المراجعة يجب أن تأتي بعد مهلة التسليم"
  if (reviewDeadline <= submissionDeadline) {
    throw new AppError(
      400,
      'INVALID_REVIEW_DEADLINE',
      'مهلة المراجعة يجب أن تأتي بعد مهلة التسليم.'
    );
  }

  const minEnrolled = await Enrollment.countDocuments({ course_id: safeCourseId, status: 'active' });
  if (minEnrolled < 3) {
    // لا نمنع الإنشاء (قد يزيد التسجيل لاحقاً قبل موعد التسليم) — فقط تنبيه صريح
    // ضمن الاستجابة، يُحسَم الأمر فعلياً عند UC-PEER-02 إن ظل العدد ناقصاً.
    // (راجع allocation.service.js: INSUFFICIENT_SUBMISSIONS)
  }

  const assignment = await PeerAssignment.create({
    courseId: safeCourseId,
    instructorId: safeInstructorId,
    title: assignmentData.title,
    description: assignmentData.description || '',
    rubric: assignmentData.rubric,
    submissionDeadline,
    reviewDeadline,
    reviewersPerSubmission: assignmentData.reviewersPerSubmission || 2,
    status: 'open',
  });

  await auditService.record({
    actorId: safeInstructorId,
    actorRole: 'Instructor',
    action: 'PEER_ASSIGNMENT_CREATED',
    resourceType: 'PeerAssignment',
    resourceId: assignment._id.toString(),
    metadata: { courseId: safeCourseId.toString(), submissionDeadline, reviewDeadline },
    req,
  });

  // TODO(email): إشعار الطلاب المسجَّلين بالمهمة الجديدة — نفس نمط
  // TODO مؤجَّل سابقاً في LIVE (sendLiveSessionScheduledNotification)

  return { success: true, data: { assignment } };
}

/**
 * UC-PEER-01/03 — عرض قائمة المهام (محاضر: مهامه، طالب: مهام كورساته المسجَّل بها)
 */
async function listAssignmentsForViewer({ userId, role, queryParams = {} }) {
  const safeUserId = toObjectId(userId, 'userId');
  const filter = {};

  if (queryParams.status && ['open', 'distributed', 'completed'].includes(queryParams.status)) {
    filter.status = queryParams.status;
  }

  if (role === 'Instructor') {
    filter.instructorId = safeUserId;
  } else {
    const activeEnrollments = await Enrollment.find({ student_id: safeUserId, status: 'active' })
      .select('course_id')
      .lean();
    const courseIds = activeEnrollments.map((e) => e.course_id);
    if (courseIds.length === 0) {
      return { success: true, data: { assignments: [] } };
    }
    filter.courseId = { $in: courseIds };
  }

  const assignments = await PeerAssignment.find(filter).sort({ submissionDeadline: 1 }).lean();
  return { success: true, data: { assignments } };
}

/**
 * تفاصيل مهمة واحدة — بفحص صلاحية الوصول (محاضر مالك، أو طالب مسجَّل بالكورس)
 */
async function getAssignmentDetails({ userId, role, assignmentId }) {
  const safeAssignmentId = toObjectId(assignmentId, 'assignmentId');
  const assignment = await PeerAssignment.findById(safeAssignmentId).lean();
  if (!assignment) {
    throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'المهمة غير موجودة.');
  }

  if (role === 'Instructor') {
    if (assignment.instructorId.toString() !== userId.toString()) {
      throw new AppError(403, 'FORBIDDEN', 'لا تملك صلاحية الاطلاع على هذه المهمة.');
    }
  } else {
    const enrolled = await Enrollment.findOne({
      student_id: userId,
      course_id: assignment.courseId,
      status: 'active',
    }).lean();
    if (!enrolled) {
      throw new AppError(403, 'FORBIDDEN', 'غير مسجل في كورس هذه المهمة.');
    }
  }

  return { success: true, data: { assignment } };
}

module.exports = {
  createAssignment,
  listAssignmentsForViewer,
  getAssignmentDetails,
  assertInstructorOwnsCourse,
};
