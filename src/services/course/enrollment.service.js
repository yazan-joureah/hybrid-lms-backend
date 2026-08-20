// src/services/course/enrollment.service.js
const Course = require('../../models/Course');
const Enrollment = require('../../models/Enrollment');
const { AppError } = require('../../middleware/errorHandler');
const auditService = require('../auditService');
const { toObjectId } = require('../../utils/objectId.util');
const { loadOwnedCourse, paginateQuery } = require('./courseAccess.util');

const BLOCKING_ENROLLMENT_STATUSES = ['pending_payment', 'active', 'completed'];

async function checkEnrollmentEligibility({ studentId, courseId }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeCourseId = toObjectId(courseId, 'courseId');

  const course = await Course.findById(safeCourseId);
  if (!course || course.status !== 'published') {
    throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found.');
  }

  const existing = await Enrollment.findOne({
    course_id: safeCourseId,
    student_id: safeStudentId,
    status: { $in: BLOCKING_ENROLLMENT_STATUSES },
  });
  if (existing) {
    throw new AppError(409, 'ALREADY_ENROLLED', 'You are already enrolled in this course.');
  }

  // A prerequisite is satisfied only by a COMPLETED enrollment.
  if (course.prerequisite_course_ids?.length > 0) {
    const completedCount = await Enrollment.countDocuments({
      student_id: safeStudentId,
      course_id: { $in: course.prerequisite_course_ids },
      status: 'completed',
    });
    if (completedCount < course.prerequisite_course_ids.length) {
      throw new AppError(
        400,
        'PREREQUISITES_NOT_MET',
        'You must complete the prerequisite course(s) first.'
      );
    }
  }

  if (course.is_synchronous && course.max_students != null) {
    const activeCount = await Enrollment.countDocuments({
      course_id: safeCourseId,
      status: { $in: ['pending_payment', 'active'] },
    });
    if (activeCount >= course.max_students) {
      throw new AppError(
        409,
        'COURSE_FULL',
        'This course has reached its maximum number of students.'
      );
    }
  }

  return course;
}

async function enrollInCourse({ studentId, courseId, req }) {
  const course = await checkEnrollmentEligibility({ studentId, courseId });
  const isFree = course.course_type === 'free';
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeCourseId = toObjectId(courseId, 'courseId');

  const enrollment = new Enrollment({
    course_id: safeCourseId,
    student_id: safeStudentId,
    status: isFree ? 'active' : 'pending_payment',
    confirmed_by_student: true,
    activated_at: isFree ? new Date() : null,
  });
  await enrollment.save();

  await auditService.record({
    actorId: safeStudentId,
    actorRole: 'Student',
    action: 'COURSE_ENROLLED',
    resourceType: 'Enrollment',
    resourceId: enrollment._id.toString(),
    metadata: {
      course_id: safeCourseId,
      course_type: course.course_type,
      status: enrollment.status,
    },
    req,
  });

  return {
    success: true,
    data: {
      enrollment,
      message: isFree
        ? 'Enrollment activated successfully.'
        : 'Enrollment created — payment integration is not yet available. This course will activate once the PAY module is implemented.',
    },
  };
}

async function listMyEnrollments({ studentId, queryParams = {} }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const { records: enrollments, meta } = await paginateQuery({
    model: Enrollment,
    query: { student_id: safeStudentId },
    queryParams,
    sort: { enrolled_at: -1 },
    populate: { path: 'course_id', select: 'title category course_type is_synchronous' },
  });
  return { success: true, data: { enrollments, meta } };
}

async function activatePendingEnrollment({ enrollmentId }) {
  const enrollment = await Enrollment.findById(enrollmentId);
  if (!enrollment) {
    throw new AppError(404, 'ENROLLMENT_NOT_FOUND', 'Enrollment not found.');
  }
  if (enrollment.status !== 'pending_payment') {
    return { success: true, data: { enrollment, alreadyActive: true } };
  }

  enrollment.status = 'active';
  enrollment.activated_at = new Date();
  await enrollment.save();

  return { success: true, data: { enrollment, alreadyActive: false } };
}

async function cancelEnrollmentForRefund({ enrollmentId }) {
  const enrollment = await Enrollment.findById(enrollmentId);
  if (!enrollment) {
    throw new AppError(404, 'ENROLLMENT_NOT_FOUND', 'Enrollment not found.');
  }
  if (enrollment.status === 'cancelled') {
    return { success: true, data: { enrollment, alreadyCancelled: true } };
  }

  enrollment.status = 'cancelled';
  await enrollment.save();

  return { success: true, data: { enrollment, alreadyCancelled: false } };
}

/** Instructor-facing roster for a course they own. */
async function getCourseStudents({ instructorId, courseId, queryParams = {}, req }) {
  const { safeCourseId } = await loadOwnedCourse({
    courseId,
    instructorId,
    req,
    attemptedAction: 'VIEW_ROSTER',
  });

  const { records: enrollments, meta } = await paginateQuery({
    model: Enrollment,
    // pending_payment excluded
    query: { course_id: safeCourseId, status: { $in: ['active', 'completed'] } },
    queryParams,
    defaultLimit: 20,
    sort: { enrolled_at: -1 },
    populate: { path: 'student_id', select: 'full_name email' },
  });

  return { success: true, data: { students: enrollments, meta } };
}

module.exports = {
  checkEnrollmentEligibility,
  enrollInCourse,
  listMyEnrollments,
  activatePendingEnrollment,
  cancelEnrollmentForRefund,
  getCourseStudents,
};
