// src/services/cert/verification.service.js
// UC-CERT-04 — Verify Certificate via QR (public, no login required)

const Certificate = require('../../models/certificate.model');
const { AppError } = require('../../middleware/errorHandler');
const auditService = require('../auditService');
const { recomputeVerificationHash } = require('./qrGeneration.service');
const { verifyCertificateSignature } = require('./signing.service');

//UC-CERT-04 — Verify Certificate via QR
async function verifyCertificate({ certificateId, req }) {
  if (!certificateId || typeof certificateId !== 'string') {
    throw new AppError(400, 'INVALID_CERTIFICATE_ID', 'A valid certificate ID is required.');
  }

  // Query certificate data and status.
  const certificate = await Certificate.findOne({ certificate_id: certificateId }).lean();
  if (!certificate) {
    return { success: true, data: { status: 'not_found' } };
  }

  // check Revocation List status.
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

  // extract stored hash, recompute from current data, compare.
  const recomputedHash = recomputeVerificationHash({
    certificateId: certificate.certificate_id,
    studentNameSnapshot: certificate.student_name_snapshot,
    courseTitleSnapshot: certificate.course_title_snapshot,
    issuedAt: certificate.issued_at,
  });

  if (recomputedHash !== certificate.verification_hash) {
    await auditService.record({
      actorId: null,
      actorRole: 'System',
      action: 'CERTIFICATE_VERIFICATION_HASH_MISMATCH',
      resourceType: 'Certificate',
      resourceId: certificate.certificate_id,
      metadata: {},
      req,
    });
    return { success: true, data: { status: 'tampered' } };
  }

  // verify the digital signature with the public key.
  const signatureValid = verifyCertificateSignature({
    verificationHash: certificate.verification_hash,
    signatureBase64: certificate.signature,
  });

  if (!signatureValid) {
    await auditService.record({
      actorId: null,
      actorRole: 'System',
      action: 'CERTIFICATE_VERIFICATION_SIGNATURE_INVALID',
      resourceType: 'Certificate',
      resourceId: certificate.certificate_id,
      metadata: {},
      req,
    });
    return { success: true, data: { status: 'untrusted' } };
  }

  // display the final result to the user.
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
    },
  };
}

module.exports = { verifyCertificate };
