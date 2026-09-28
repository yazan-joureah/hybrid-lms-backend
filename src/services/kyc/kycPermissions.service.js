// src/services/kyc/kycPermissions.service.js

const auditService = require('../auditService');

async function grantInstructorPermissions({
  instructorUserId,
  reviewingAdminId,
  reviewingAdminRole,
  req,
}) {
  await auditService.record({
    actorId: reviewingAdminId,
    actorRole: reviewingAdminRole,
    action: 'KYC_INSTRUCTOR_PERMISSIONS_GRANTED',
    resourceType: 'User',
    resourceId: instructorUserId,
    metadata: {
      note: 'Implicit activation via role=Instructor + kyc_status=verified — no direct modification to User entity',
    },
    req,
  });
}

module.exports = {
  grantInstructorPermissions,
};
