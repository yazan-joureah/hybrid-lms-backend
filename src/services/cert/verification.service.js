// src/services/cert/verification.service.js
// UC-CERT-04 — Verify Certificate via QR (public, no login required)

const Certificate = require('../../models/certificate.model');
const Course = require('../../models/Course');
const { AppError } = require('../../middleware/errorHandler');
const auditService = require('../auditService');
const { issueCredentialJwt } = require('./credential.service');

async function verifyCertificate({ certificateId, req }) {
  if (!certificateId || typeof certificateId !== 'string') {
    throw new AppError(400, 'INVALID_CERTIFICATE_ID', 'A valid certificate ID is required.');
  }

  const certificate = await Certificate.findOne({ certificate_id: certificateId }).lean();
  if (!certificate) {
    return { success: true, data: { status: 'not_found' } };
  }

  if (certificate.status === 'revoked') {
    return {
      success: true,
      data: {
        status: 'revoked',
        certificate: {
          certificate_id: certificate.certificate_id,
          student_name: certificate.student_name_snapshot,
          course_title: certificate.course_title_snapshot,
          issued_at: certificate.issued_at,
          superseded_by: certificate.superseded_by,
        },
      },
    };
  }

  const course = await Course.findById(certificate.course_id)
    .select('certificate_criteria description')
    .lean();

  const { token } = await issueCredentialJwt({
    certificate,
    criteriaNarrative: course?.certificate_criteria,
    courseDescription: course?.description,
  });

  await auditService.record({
    actorId: null,
    actorRole: 'System',
    action: 'CERTIFICATE_VERIFIED',
    resourceType: 'Certificate',
    resourceId: certificate.certificate_id,
    metadata: {},
    req,
  });

  return {
    success: true,
    data: {
      status: 'valid',
      certificate: {
        certificate_id: certificate.certificate_id,
        student_name: certificate.student_name_snapshot,
        course_title: certificate.course_title_snapshot,
        issued_at: certificate.issued_at,
      },
      credential_jwt: token,
    },
  };
}

module.exports = { verifyCertificate };
