const authService = require('../../services/authService');
const { issueSessionCookies } = require('../../utils/sessionCookies.util');
const { AppError } = require('../../middleware/errorHandler');
const env = require('../../config/env');

async function googleConsent(req, res, next) {
  try {
    const url = await authService.getGoogleConsentUrl();
    return res.redirect(url);
  } catch (err) {
    next(err);
  }
}

const OAUTH_ERRORS = {
  INVALID_STATE: { status: 403, message: 'Invalid or expired OAuth session. Please try again.' },
  GOOGLE_EXCHANGE_FAILED: {
    status: 502,
    message: 'Could not complete Google sign-in. Please try again.',
  },
  GOOGLE_EMAIL_NOT_VERIFIED: { status: 403, message: 'Your Google email is not verified.' },
  ACCOUNT_SUSPENDED: {
    status: 403,
    message: 'Your account has been suspended. Please contact support.',
  },
  GUARDIAN_PENDING: { status: 403, message: 'Waiting for guardian approval.' },
  TOKEN_INVALID: { status: 401, message: 'Invalid or expired token.' },
};

/** Shared response shaping for AJAX POST flows that end in a completed/challenged login. */
function finishOAuthLogin(result, res) {
  if (result.mfaRequired) {
    return res.status(200).json({
      success: true,
      data: {
        mfa_required: true,
        mfa_temp_token: result.mfaTempToken,
        mfa_method: result.mfaMethod,
        mfa_timeout_seconds: 300,
      },
    });
  }

  issueSessionCookies(res, result.refreshTokenRaw);

  return res.status(200).json({
    success: true,
    data: { access_token: result.accessToken, user: result.user },
  });
}

/**
 * GET /api/v1/auth/google/callback
 * Browser GET request direct from Google redirect
 */
async function googleCallback(req, res) {
  const frontendUrl = env.frontUrl || 'http://localhost:5173';

  try {
    const result = await authService.handleGoogleCallback({
      code: req.query.code,
      state: req.query.state,
      req,
    });

    if (result.error) {
      const info = OAUTH_ERRORS[result.error] || { message: 'Google authentication failed.' };
      return res.redirect(`${frontendUrl}/login?oauth_error=${encodeURIComponent(info.message)}`);
    }

    // Case 1: Account with same email exists -> redirect to password link form
    if (result.requiresLinkConfirmation) {
      return res.redirect(
        `${frontendUrl}/login?oauth_step=google-link&token=${encodeURIComponent(result.linkPendingToken)}`
      );
    }

    // Case 2: New user -> redirect to birth date entry form
    if (result.requiresBirthDate) {
      return res.redirect(
        `${frontendUrl}/login?oauth_step=google-register&token=${encodeURIComponent(result.registrationPendingToken)}`
      );
    }

    // Case 3: User has MFA enabled -> redirect to MFA challenge form
    if (result.mfaRequired) {
      return res.redirect(
        `${frontendUrl}/login?oauth_step=mfa&token=${encodeURIComponent(result.mfaTempToken)}`
      );
    }

    // Case 4: Complete Login Success -> Set session cookie and redirect to dashboard
    issueSessionCookies(res, result.refreshTokenRaw);
    return res.redirect(`${frontendUrl}/dashboard?auth=google_success`);
  } catch (err) {
    return res.redirect(
      `${frontendUrl}/login?oauth_error=${encodeURIComponent('Google authentication failed. Please try again.')}`
    );
  }
}

/** POST /api/v1/auth/google/link/confirm */
async function googleLinkConfirm(req, res, next) {
  try {
    const result = await authService.confirmGoogleLink({
      rawToken: req.validatedBody.link_pending_token,
      password: req.validatedBody.password,
      req,
    });

    if (result.error) {
      const messages = {
        ...OAUTH_ERRORS,
        INVALID_PASSWORD: { status: 401, message: 'Incorrect password.' },
        ALREADY_LINKED_ELSEWHERE: {
          status: 409,
          message: 'This Google account is already linked to another user.',
        },
      };
      const info = messages[result.error];
      throw new AppError(info.status, result.error, info.message);
    }

    return finishOAuthLogin(result, res);
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/auth/google/register/confirm */
async function googleRegisterConfirm(req, res, next) {
  try {
    const result = await authService.confirmGoogleRegistration({
      rawToken: req.validatedBody.registration_pending_token,
      birthDate: req.validatedBody.birth_date,
      role: req.validatedBody.role,
      req,
    });

    if (result.error) {
      const info = OAUTH_ERRORS[result.error] || { status: 400, message: 'Registration failed.' };
      throw new AppError(info.status, result.error, info.message);
    }

    if (result.requiresGuardianEmail) {
      return res.status(200).json({
        success: true,
        data: {
          message: 'Account created. Guardian email required to activate.',
          requires_guardian_email: true,
          guardian_pending_token: result.guardianPendingToken,
        },
      });
    }

    return finishOAuthLogin(result, res);
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/auth/google/guardian-email */
async function googleGuardianEmail(req, res, next) {
  try {
    const result = await authService.submitGoogleGuardianEmail({
      rawToken: req.validatedBody.guardian_pending_token,
      guardianEmail: req.validatedBody.guardian_email,
      req,
    });

    if (result.error) {
      const messages = {
        TOKEN_INVALID: { status: 401, message: 'Invalid or expired token.' },
        ALREADY_PENDING: {
          status: 409,
          message: 'A guardian approval request is already pending.',
        },
      };
      const info = messages[result.error];
      throw new AppError(info.status, result.error, info.message);
    }

    return res
      .status(200)
      .json({ success: true, data: { message: 'Guardian approval request sent.' } });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  googleConsent,
  googleCallback,
  googleLinkConfirm,
  googleRegisterConfirm,
  googleGuardianEmail,
};
