// src/services/cert/certificate.service.js
// UC-CERT-01 — Issue Certificate (System Function, no HTTP route of its own)
const crypto = require('crypto');
const Certificate = require('../../models/certificate.model');
const CertificateTemplate = require('../../models/certificateTemplate.model');
const Course = require('../../models/Course');
const Enrollment = require('../../models/Enrollment');
const User = require('../../models/User');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');
const auditService = require('../auditService');
const { assertIdentityVerified } = require('../../middleware/requireVerifiedIdentity.middleware');
const { createCertificateQrCode } = require('./qrGeneration.service');
const { signAndEncryptCertificate } = require('./signing.service');
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

//UC-CERT-01 — Issue Certificate
async function issueCertificate({ studentId, courseId, req }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeCourseId = toObjectId(courseId, 'courseId');

  // Step 1: identity + conditions.
  await assertIdentityVerified(safeStudentId);

  // Preconditions — exam passed + attendance requirement met.
  await assertEnrollmentCompleted({ studentId: safeStudentId, courseId: safeCourseId });
  const student = await User.findById(safeStudentId).select('full_name email').lean();
  const course = await Course.findById(safeCourseId).select('title').lean();
  if (!student || !course) {
    throw new AppError(404, 'RECORD_NOT_FOUND', 'Student or course record not found.');
  }

  // Step 2: generates a unique Certificate ID and fetches student/course data.
  const issuedAt = new Date();
  const certificateId = crypto.randomUUID();
  // Step 3: QR code generation.
  const { qrCodeImage, verificationHash } = await createCertificateQrCode({
    certificateId,
    studentNameSnapshot: student.full_name,
    courseTitleSnapshot: course.title,
    issuedAt,
  });

  // Step 4: digital signature + encryption.
  const certificateData = {
    certificate_id: certificateId,
    student_name_snapshot: student.full_name,
    course_title_snapshot: course.title,
    issued_at: issuedAt.toISOString(),
  };
  const { signature, signingKeyVersion, encryptedContent } = signAndEncryptCertificate({
    studentId: safeStudentId,
    verificationHash,
    certificateData,
  });

  // Step 5: single save, linked to student_id. This is the ONLY write in the entire issuance flow.
  let certificate;
  try {
    certificate = await Certificate.create({
      certificate_id: certificateId,
      student_id: safeStudentId,
      course_id: safeCourseId,
      student_name_snapshot: student.full_name,
      course_title_snapshot: course.title,
      issued_at: issuedAt,
      status: 'active',
      qr_code_image: qrCodeImage,
      verification_hash: verificationHash,
      signature,
      signing_key_version: signingKeyVersion,
      encrypted_content: encryptedContent,
    });
  } catch (err) {
    // DB save failure → retry twice
    try {
      certificate = await Certificate.create({
        certificate_id: certificateId,
        student_id: safeStudentId,
        course_id: safeCourseId,
        student_name_snapshot: student.full_name,
        course_title_snapshot: course.title,
        issued_at: issuedAt,
        status: 'active',
        qr_code_image: qrCodeImage,
        verification_hash: verificationHash,
        signature,
        signing_key_version: signingKeyVersion,
        encrypted_content: encryptedContent,
      });
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

  // Step 6: Audit Log: Certificate ID, Student ID, Course ID, timestamp.
  await auditService.record({
    actorId: safeStudentId,
    actorRole: 'System',
    action: 'CERTIFICATE_ISSUED',
    resourceType: 'Certificate',
    resourceId: certificateId,
    metadata: { course_id: safeCourseId.toString() },
    req,
  });

  // Step 7: email notification. Non-critical.
  try {
    await emailService.sendCertificateIssuedEmail(student.email, {
      courseTitle: course.title,
      certificateId,
    });
  } catch (err) {
    logger.error('Certificate issuance email failed', {
      error: err.message,
      certificateId,
    });
  }

  return { success: true, data: { certificate } };
}

async function listTemplates() {
  const templates = await CertificateTemplate.find().sort({ createdAt: -1 }).lean();
  return { success: true, data: { templates } };
}

async function createTemplate({ adminId, templateData, req }) {
  const template = await CertificateTemplate.create(templateData);
  await auditService.record({
    actorId: adminId,
    actorRole: 'SuperAdmin',
    action: 'CERT_TEMPLATE_CREATED',
    resourceType: 'CertificateTemplate',
    resourceId: template._id.toString(),
    metadata: { name: template.name },
    req,
  });
  return { success: true, data: { template } };
}

async function updateTemplate({ adminId, templateId, updateData, req }) {
  const template = await CertificateTemplate.findByIdAndUpdate(templateId, updateData, {
    new: true,
    runValidators: true,
  });
  if (!template) {
    throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Certificate template not found.');
  }
  await auditService.record({
    actorId: adminId,
    actorRole: 'SuperAdmin',
    action: 'CERT_TEMPLATE_UPDATED',
    resourceType: 'CertificateTemplate',
    resourceId: templateId,
    req,
  });
  return { success: true, data: { template } };
}

async function deleteTemplate({ adminId, templateId, req }) {
  const template = await CertificateTemplate.findByIdAndDelete(templateId);
  if (!template) {
    throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Certificate template not found.');
  }
  await auditService.record({
    actorId: adminId,
    actorRole: 'SuperAdmin',
    action: 'CERT_TEMPLATE_DELETED',
    resourceType: 'CertificateTemplate',
    resourceId: templateId,
    req,
  });
  return { success: true, data: { deleted: true } };
}

async function downloadCertificate({ studentId, courseId, req }) {
  const safeStudentId = toObjectId(studentId, 'studentId');
  const safeCourseId = toObjectId(courseId, 'courseId');

  // check identity
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

  // Compare current data to last-issued snapshot.
  const dataChanged = student.full_name !== currentCertificate.student_name_snapshot;

  let certificateToServe = currentCertificate;

  if (dataChanged) {
    const issuedAt = new Date();
    const newCertificateId = crypto.randomUUID();

    // new QR code.
    const { qrCodeImage, verificationHash } = await createCertificateQrCode({
      certificateId: newCertificateId,
      studentNameSnapshot: student.full_name,
      courseTitleSnapshot: currentCertificate.course_title_snapshot,
      issuedAt,
    });

    // new signature + encryption on the updated data.
    const certificateData = {
      certificate_id: newCertificateId,
      student_name_snapshot: student.full_name,
      course_title_snapshot: currentCertificate.course_title_snapshot,
      issued_at: issuedAt.toISOString(),
    };
    const { signature, signingKeyVersion, encryptedContent } = signAndEncryptCertificate({
      studentId: safeStudentId,
      verificationHash,
      certificateData,
    });

    // save the new certificate.
    const newCertificate = await Certificate.create({
      certificate_id: newCertificateId,
      student_id: safeStudentId,
      course_id: safeCourseId,
      student_name_snapshot: student.full_name,
      course_title_snapshot: currentCertificate.course_title_snapshot,
      issued_at: issuedAt,
      status: 'active',
      qr_code_image: qrCodeImage,
      verification_hash: verificationHash,
      signature,
      signing_key_version: signingKeyVersion,
      encrypted_content: encryptedContent,
    });

    // add the old certificate_id to the Revocation List.
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

module.exports = {
  issueCertificate,
  assertEnrollmentCompleted,
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  downloadCertificate,
};
