// src/services/course/enrollment.service.js
const Course = require('../../models/Course');
const Enrollment = require('../../models/Enrollment');
const { AppError } = require('../../middleware/errorHandler');
const auditService = require('../auditService');
const { toObjectId } = require('../../utils/objectId.util');

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

  // a prerequisite is satisfied only by a COMPLETED
  // enrollment in that course — no partial-progress credit.
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

  // Synchronous course capacity check
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

/**
 * enrolls a student. Free courses activate immediately;
 * paid courses create a pending_payment record.
 */
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

/** Lists all of the student's own enrollments (any status). */
async function listMyEnrollments({ studentId, queryParams = {} }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const page = parseInt(queryParams.page, 10) || 1;
  const limit = parseInt(queryParams.limit, 10) || 10;
  const skip = (page - 1) * limit;

  const query = { student_id: safeStudentId };

  const [enrollments, totalRecords] = await Promise.all([
    Enrollment.find(query)
      .populate('course_id', 'title category course_type is_synchronous')
      .sort({ enrolled_at: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Enrollment.countDocuments(query),
  ]);

  return {
    success: true,
    data: {
      enrollments,
      meta: {
        total_records: totalRecords,
        current_page: page,
        total_pages: Math.ceil(totalRecords / limit),
      },
    },
  };
}

module.exports = { checkEnrollmentEligibility, enrollInCourse, listMyEnrollments };
