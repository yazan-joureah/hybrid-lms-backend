// src/services/cert/certificateList.service.js
// UC-CERT-07 — My Certificates

const Certificate = require('../../models/certificate.model');
const Enrollment = require('../../models/Enrollment');
const auditService = require('../auditService');
const { toObjectId } = require('../../utils/objectId.util');
const { assertIdentityVerified } = require('../../middleware/requireVerifiedIdentity.middleware');
const { issueCertificate } = require('./certificate.service');

// UC-CERT-07 — My Certificates
async function listMyCertificates({ studentId, req }) {
  const safeStudentId = toObjectId(studentId, 'studentId');

  // Opportunistic retry — see retryPendingIssuances docstring.
  await retryPendingIssuances({ studentId: safeStudentId, req });

  const certificates = await Certificate.find({ student_id: safeStudentId })
    .select(
      'certificate_id course_id course_title_snapshot student_name_snapshot issued_at status superseded_by'
    )
    .sort({ issued_at: -1 })
    .lean();

  // log the view event.
  await auditService.record({
    actorId: safeStudentId,
    actorRole: 'Student',
    action: 'VIEW_LIST_CERT',
    resourceType: 'Certificate',
    resourceId: safeStudentId.toString(),
    metadata: { count: certificates.length },
    req,
  });

  return { success: true, data: { certificates } };
}

async function retryPendingIssuances({ studentId, req }) {
  try {
    await assertIdentityVerified(studentId);
  } catch {
    return;
  }

  const completedEnrollments = await Enrollment.find({
    student_id: studentId,
    status: 'completed',
  })
    .select('course_id')
    .lean();

  for (const enrollment of completedEnrollments) {
    // eslint-disable-next-line no-await-in-loop -- sequential, low volume (a student's own completed courses)
    const alreadyIssued = await Certificate.exists({
      student_id: studentId,
      course_id: enrollment.course_id,
      status: 'active',
    });
    if (alreadyIssued) continue;
    // eslint-disable-next-line no-await-in-loop
    await issueCertificate({ studentId, courseId: enrollment.course_id, req }).catch((err) => {
      auditService.record({
        actorId: studentId,
        actorRole: 'System',
        action: 'CERTIFICATE_RETRY_ISSUANCE_FAILED',
        resourceType: 'Enrollment',
        resourceId: enrollment.course_id.toString(),
        metadata: { error_code: err.code },
        req,
      });
    });
  }
}
module.exports = { listMyCertificates, retryPendingIssuances };
