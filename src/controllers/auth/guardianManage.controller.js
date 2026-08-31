const {
  getGuardianApprovalStatus,
  resendGuardianApproval,
  updateGuardianEmail,
} = require('../../services/auth/guardianManage.service');

/** GET /auth/guardian/manage?token=... */
async function getStatus(req, res, next) {
  try {
    const result = await getGuardianApprovalStatus({ rawToken: req.query.token });
    return res.status(200).json({
      success: true,
      data: {
        status: result.status,
        guardian_email: result.guardianEmail,
        expires_at: result.expiresAt,
        resend_count: result.resendCount,
        max_resend_count: result.maxResendCount,
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function resend(req, res, next) {
  try {
    const result = await resendGuardianApproval({ rawToken: req.validatedBody.token, req });
    return res.status(200).json({ success: true, data: { resend_count: result.resendCount } });
  } catch (err) {
    return next(err);
  }
}

async function updateEmail(req, res, next) {
  try {
    const result = await updateGuardianEmail({
      rawToken: req.validatedBody.token,
      newGuardianEmail: req.validatedBody.guardian_email,
      req,
    });
    return res.status(200).json({ success: true, data: { guardian_email: result.guardianEmail } });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getStatus, resend, updateEmail };
