const authService = require('../../services/authService');
const { AppError } = require('../../middleware/errorHandler');

async function register(req, res, next) {
  try {
    const result = await authService.registerUser({ ...req.validatedBody, req });

    if (result.requiresGuardianApproval) {
      return res.status(201).json({
        success: true,
        data: {
          message: 'Verification code sent. Guardian approval also required.',
          requires_guardian_approval: true,
        },
      });
    }

    return res.status(201).json({ success: true, data: { message: 'Verification code sent' } });
  } catch (err) {
    next(err);
  }
}

async function verifyEmail(req, res, next) {
  try {
    const { email, code } = req.validatedBody;
    const result = await authService.verifyEmail({ email, code, req });

    if (result.error) {
      const statusMap = { INVALID_CODE: 400, CODE_EXPIRED: 400, TOO_MANY_ATTEMPTS: 429 };
      return res.status(statusMap[result.error] || 400).json({
        success: false,
        error: { code: result.error, message: 'Verification failed.' },
      });
    }

    return res
      .status(200)
      .json({ success: true, data: { status: result.status, next_step: result.nextStep } });
  } catch (err) {
    return next(err);
  }
}

async function resendVerification(req, res, next) {
  try {
    const { email } = req.validatedBody;
    await authService.resendVerification({ email, req });

    return res.status(200).json({
      success: true,
      data: { message: 'If an account exists and is not yet verified, a new code has been sent.' },
    });
  } catch (err) {
    return next(err);
  }
}

async function guardianApprovePagePlaceholder(req, res) {
  return res.status(200).json({
    success: true,
    data: {
      message:
        'PLACEHOLDER — no real HTML form yet. Use POST /auth/guardian/approve with this token.',
      token_received: Boolean(req.query.token),
    },
  });
}

async function guardianApprove(req, res, next) {
  try {
    const {
      token,
      decision,
      guardian_full_name: guardianFullName,
      relationship,
    } = req.validatedBody;

    const result = await authService.processGuardianApproval({
      rawToken: token,
      decision,
      guardianFullName,
      relationship,
      req,
    });

    if (result.error) {
      throw new AppError(400, result.error, 'Guardian approval failed');
    }

    const MESSAGES = {
      active: 'Account activated.',
      guardian_pending:
        result.decision === 'decline'
          ? 'Declined. Student has been notified to update guardian info.'
          : 'Approval recorded. Waiting for student to verify email.',
    };

    return res.status(200).json({
      success: true,
      data: { message: MESSAGES[result.status], status: result.status },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  register,
  verifyEmail,
  resendVerification,
  guardianApprovePagePlaceholder,
  guardianApprove,
};
