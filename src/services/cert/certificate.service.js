// src/services/cert/certificate.service.js
// UC-CERT-01 — Issue Certificate (System Function, no HTTP route of its own)
const crypto = require('crypto');
const Certificate = require('../../models/certificate.model');
const Course = require('../../models/Course');
const Enrollment = require('../../models/Enrollment');
const User = require('../../models/User');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');
const auditService = require('../auditService');
const { assertIdentityVerified } = require('../../middleware/requireVerifiedIdentity.middleware');
const { generateCertificateQrCode } = require('./credential.service');
const logger = require('../../utils/logger');
const emailService = require('../emailService');

async function assertEnrollmentCompleted({ studentId, courseId }) {
  const enrollment = await Enrollment.findOne({
    student_id: studentId,
    course_id: courseId,
    status: 'completed',
  }).lean();
  if (!enrollment) {
    throw new AppError(
      400,
      'ENROLLMENT_NOT_COMPLETED',
      'Student has not met all course completion requirements (content, attendance, and quizzes).'
    );
  }
  return enrollment;
}

async function issueCertificate({ studentId, courseId, req }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeCourseId = toObjectId(courseId, 'courseId');

  await assertIdentityVerified(safeStudentId);
  await assertEnrollmentCompleted({ studentId: safeStudentId, courseId: safeCourseId });

  const student = await User.findById(safeStudentId).select('full_name email').lean();
  const course = await Course.findById(safeCourseId).select('title').lean();
  if (!student || !course) {
    throw new AppError(404, 'RECORD_NOT_FOUND', 'Student or course record not found.');
  }

  const issuedAt = new Date();
  const certificateId = crypto.randomUUID();

  const { qrCodeImage } = await generateCertificateQrCode(certificateId);

  const buildDoc = () => ({
    certificate_id: certificateId,
    student_id: safeStudentId,
    course_id: safeCourseId,
    student_name_snapshot: student.full_name,
    course_title_snapshot: course.title,
    issued_at: issuedAt,
    status: 'active',
    qr_code_image: qrCodeImage,
  });

  let certificate;
  try {
    certificate = await Certificate.create(buildDoc());
  } catch (err) {
    try {
      certificate = await Certificate.create(buildDoc());
    } catch (retryErr) {
      await auditService.record({
        actorId: safeStudentId,
        actorRole: 'System',
        action: 'CERTIFICATE_ISSUANCE_SAVE_FAILED',
        resourceType: 'Certificate',
        resourceId: certificateId,
        metadata: { error: retryErr.message },
        req,
      });
      throw new AppError(
        500,
        'CERTIFICATE_SAVE_FAILED',
        'Failed to save the issued certificate after retry.'
      );
    }
  }

  await auditService.record({
    actorId: safeStudentId,
    actorRole: 'System',
    action: 'CERTIFICATE_ISSUED',
    resourceType: 'Certificate',
    resourceId: certificateId,
    metadata: { course_id: safeCourseId.toString() },
    req,
  });

  try {
    await emailService.sendCertificateIssuedEmail(student.email, {
      courseTitle: course.title,
      certificateId,
    });
  } catch (err) {
    logger.error('Certificate issuance email failed', { error: err.message, certificateId });
  }

  return { success: true, data: { certificate } };
}

async function downloadCertificate({ studentId, courseId, req }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeCourseId = toObjectId(courseId, 'courseId');

  await assertIdentityVerified(safeStudentId);

  const currentCertificate = await Certificate.findOne({
    student_id: safeStudentId,
    course_id: safeCourseId,
    status: 'active',
  });
  if (!currentCertificate) {
    throw new AppError(404, 'CERTIFICATE_NOT_FOUND', 'No certificate found for this course.');
  }

  const student = await User.findById(safeStudentId).select('full_name').lean();
  if (!student) {
    throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student account does not exist.');
  }

  const dataChanged = student.full_name !== currentCertificate.student_name_snapshot;
  let certificateToServe = currentCertificate;

  if (dataChanged) {
    const issuedAt = new Date();
    const newCertificateId = crypto.randomUUID();
    const { qrCodeImage } = await generateCertificateQrCode(newCertificateId);

    const newCertificate = await Certificate.create({
      certificate_id: newCertificateId,
      student_id: safeStudentId,
      course_id: safeCourseId,
      student_name_snapshot: student.full_name,
      course_title_snapshot: currentCertificate.course_title_snapshot,
      issued_at: issuedAt,
      status: 'active',
      qr_code_image: qrCodeImage,
    });

    try {
      currentCertificate.status = 'revoked';
      currentCertificate.superseded_by = newCertificateId;
      await currentCertificate.save();
    } catch (err) {
      try {
        currentCertificate.status = 'revoked';
        currentCertificate.superseded_by = newCertificateId;
        await currentCertificate.save();
      } catch (retryErr) {
        await auditService.record({
          actorId: safeStudentId,
          actorRole: 'System',
          action: 'CERTIFICATE_REVOCATION_FAILED',
          resourceType: 'Certificate',
          resourceId: currentCertificate.certificate_id,
          metadata: { error: retryErr.message, superseded_by: newCertificateId },
          req,
        });
      }
    }

    certificateToServe = newCertificate;
  }

  await auditService.record({
    actorId: safeStudentId,
    actorRole: 'Student',
    action: 'CERTIFICATE_DOWNLOADED',
    resourceType: 'Certificate',
    resourceId: certificateToServe.certificate_id,
    metadata: { re_issued: dataChanged },
    req,
  });

  return { success: true, data: { certificate: certificateToServe } };
}

module.exports = { issueCertificate, assertEnrollmentCompleted, downloadCertificate };
