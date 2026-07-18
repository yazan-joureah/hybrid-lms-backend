const authService = require('../../services/authService');

async function register(req, res, next) {
  try {
    const result = await authService.registerUser({ ...req.validatedBody, req });

    if (result.requiresGuardianApproval) {
      return res.status(201).json({
        success: true,
        data: {
          message: 'Verification email sent. Guardian approval also required.',
          requires_guardian_approval: true,
        },
      });
    }

    return res.status(201).json({
      success: true,
      data: { message: 'Verification email sent' },
    });
  } catch (err) {
    next(err);
  }
}

/** GET /auth/verify-email */
async function verifyEmail(req, res, next) {
  try {
    const rawToken = req.query.token;

    if (!rawToken || typeof rawToken !== 'string') {
      return res.status(400).json({
        success: false,
        error: { code: 'TOKEN_INVALID', message: 'Verification token is missing or invalid.' },
      });
    }

    const result = await authService.verifyEmail({ rawToken, req });

    if (result.error) {
      const ERROR_MESSAGES = {
        TOKEN_INVALID: 'This verification link is invalid.',
        TOKEN_ALREADY_USED: 'This verification link has already been used.',
        TOKEN_EXPIRED: 'This verification link has expired. Please request a new one.',
      };
      return res.status(400).json({
        success: false,
        error: { code: result.error, message: ERROR_MESSAGES[result.error] },
      });
    }

    const message =
      result.status === 'active'
        ? 'Email verified. You can now log in.'
        : 'Email verified. Waiting for guardian approval.';

    return res.status(200).json({
      success: true,
      data: { message, next_step: result.nextStep, status: result.status },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /auth/guardian/approve — ⚠️ TEMPORARY BACKEND-ONLY PLACEHOLDER.
 * TODO: remove once Frontend team ships the real page.
 */
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
      const ERROR_MESSAGES = {
        TOKEN_INVALID: 'This approval link is invalid.',
        TOKEN_ALREADY_USED: 'This approval link has already been used.',
        TOKEN_EXPIRED: 'This approval link has expired. The account has been removed per policy.',
      };
      return res.status(400).json({
        success: false,
        error: { code: result.error, message: ERROR_MESSAGES[result.error] },
      });
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

/** GET /auth/me */
async function getMe(req, res, next) {
  try {
    const userData = await authService.getUserProfile({ userId: req.user.id });
    return res.status(200).json({ success: true, data: userData });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, verifyEmail, guardianApprovePagePlaceholder, guardianApprove, getMe };
