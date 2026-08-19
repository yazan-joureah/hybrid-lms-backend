// src/services/quiz/certificateEligibility.service.js
// UC-QUIZ-05 — Link Exam Result to Certificate Eligibility
//
// Triggered automatically as the final step of UC-QUIZ-04 (Grade Quiz &
// Log Results) — see gradeAttempt() in quizSession.service.js.

const Quiz = require('../../models/quiz.model');
const Enrollment = require('../../models/Enrollment');
const Certificate = require('../../models/certificate.model');
const User = require('../../models/User');
const Course = require('../../models/Course');
const logger = require('../../utils/logger');
const { toObjectId } = require('../../utils/objectId.util');
const { getCompletionCounts, checkAndMarkCompletion } = require('../progress.service');
const { issueCertificate } = require('./certificate.service');
const auditService = require('../auditService');
const emailService = require('../emailService');

//UC-QUIZ-05 — re-evaluates course completion right after a quiz attempt
//is graded, and issues a certificate if the student JUST became eligible.

async function checkCertificateEligibilityAfterGrading({ attempt, req }) {
  try {
    const quiz = await Quiz.findById(attempt.quiz_id).select('course_id').lean();
    if (!quiz) return;

    const safeStudentId = toObjectId(attempt.student_id, 'studentId');
    const safeCourseId = toObjectId(quiz.course_id, 'courseId');

    // Prevents ever re-issuing a duplicate
    // certificate if this check somehow runs twice for the same student
    // + course
    const alreadyIssued = await Certificate.exists({
      student_id: safeStudentId,
      course_id: safeCourseId,
      status: 'active',
    });
    if (alreadyIssued) return;

    const enrollment = await Enrollment.findOne({
      student_id: safeStudentId,
      course_id: safeCourseId,
      status: { $in: ['active', 'completed'] },
    });
    if (!enrollment) return;

    const { percentage } = await getCompletionCounts({
      courseId: safeCourseId,
      studentId: safeStudentId,
    });
    await checkAndMarkCompletion({
      enrollment,
      courseId: safeCourseId,
      percentage,
      studentId: safeStudentId,
    });

    if (enrollment.status !== 'completed') {
      return;
    }

    // Step 3: all conditions met
    try {
      await issueCertificate({ studentId: safeStudentId, courseId: safeCourseId, req });
    } catch (issueErr) {
      const isIdentityGate =
        issueErr.code === 'KYC_NOT_VERIFIED' || issueErr.code === 'MFA_REQUIRED';

      await auditService.record({
        actorId: safeStudentId,
        actorRole: 'System',
        action: isIdentityGate
          ? 'CERTIFICATE_ISSUANCE_BLOCKED_IDENTITY_NOT_VERIFIED'
          : 'CERTIFICATE_ISSUANCE_FAILED',
        resourceType: 'Enrollment',
        resourceId: safeCourseId.toString(),
        metadata: { student_id: safeStudentId.toString(), error_code: issueErr.code },
        req,
      });
      if (isIdentityGate) {
        const student = await User.findById(safeStudentId).select('email').lean();
        const course = await Course.findById(safeCourseId).select('title').lean();
        if (student) {
          emailService
            .sendCertificatePendingVerificationEmail(student.email, {
              courseTitle: course?.title || 'your course',
              missingKyc: issueErr.code === 'KYC_NOT_VERIFIED',
              missingMfa: issueErr.code === 'MFA_REQUIRED',
            })
            .catch((emailErr) =>
              logger.error('Certificate-pending email failed (non-critical)', {
                error: emailErr.message,
              })
            );
        }
      }
      throw issueErr;
    }
  } catch (err) {
    logger.error('UC-QUIZ-05 certificate eligibility check failed (non-critical)', {
      error: err.message,
      attemptId: attempt._id?.toString(),
    });
  }
}

module.exports = { checkCertificateEligibilityAfterGrading };
