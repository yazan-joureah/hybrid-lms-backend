// src/services/kyc/kycPermissions.service.js
//
// Implementation of SF-KYC-01. After reviewing the actual User.js, it was determined
// that "granting course permissions" does not require any actual modification to the User entity:
// real verification when creating/managing courses (UC-COURSE-05 and similar) relies
// entirely on role === 'Instructor' (via SF-AUTH-01) + kyc_status === 'verified'
// (via SF-AUTH-03) — both are already updated by this point (role is set
// since registration, kyc_status is updated in kycReview.service.js before
// calling this function). Therefore, this function is purely for documentation
// (Audit Log) — it does not change any state, it only records the moment
// "permissions became effective" in an explicit and traceable manner,
// distinguishing it from the general "KYC status update" event in the Audit Log.
//
// References: FR-42, FR-30 | UC-KYC-02 Step 9

const auditService = require('../auditService');

/**
 * @param {object} params
 * @param {string} params.instructorUserId - ID of the instructor whose request was accepted
 * @param {string} params.reviewingAdminId - ID of the Admin who made the decision
 * @param {string} params.reviewingAdminRole - Role of the reviewer (Admin/SuperAdmin) because auditService enforces it
 * @param {import('express').Request} params.req
 * @returns {Promise<void>}
 */
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
