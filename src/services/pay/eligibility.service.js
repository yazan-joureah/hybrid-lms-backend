// src/services/pay/eligibility.service.js
/** SF-PAY-01: validates payment eligibility before initiating a charge. */
const Course = require('../../models/Course');
const User = require('../../models/User');
const Enrollment = require('../../models/Enrollment');
const Payment = require('../../models/Payment');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');

/**
 * confirms the course is still payable, the student account is
 * active, and the linked enrollment is genuinely awaiting payment.
 * Returns the fetched course + enrollment for the caller to reuse (avoids
 * a duplicate re-fetch in payment.service.js).
 */
async function checkPaymentEligibility({ studentId, enrollmentId }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeEnrollmentId = toObjectId(enrollmentId, 'enrollmentId');

  const enrollment = await Enrollment.findOne({
    _id: safeEnrollmentId,
    student_id: safeStudentId,
    status: 'pending_payment',
  });
  if (!enrollment) {
    throw new AppError(
      404,
      'ENROLLMENT_NOT_FOUND',
      'No pending payment found for this enrollment.'
    );
  }

  const course = await Course.findOne({
    _id: enrollment.course_id,
    status: 'published',
    course_type: 'paid',
  });
  if (!course) {
    throw new AppError(
      400,
      'COURSE_NOT_AVAILABLE',
      'This course is not currently available for payment.'
    );
  }

  const student = await User.findById(safeStudentId).select('status').lean();
  if (!student || student.status !== 'active') {
    throw new AppError(403, 'STUDENT_NOT_ELIGIBLE', 'You are not eligible to make this payment.');
  }

  const existingPaid = await Payment.findOne({
    enrollment_id: safeEnrollmentId,
    status: 'paid',
  }).lean();
  if (existingPaid) {
    throw new AppError(409, 'ALREADY_PAID', 'This enrollment has already been paid for.');
  }

  return { course, enrollment };
}
module.exports = { checkPaymentEligibility };
