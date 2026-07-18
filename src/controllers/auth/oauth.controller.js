const authService = require('../../services/authService');
const { issueSessionCookies } = require('../../utils/sessionCookies.util');

async function googleConsent(req, res, next) {
  try {
    const url = await authService.getGoogleConsentUrl();
    return res.redirect(url);
  } catch (err) {
    next(err);
  }
}

const OAUTH_ERROR_RESPONSES = {
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

/** Shared response shaping for any flow that ends in a completed/challenged login. */
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

async function googleCallback(req, res, next) {
  try {
    const result = await authService.handleGoogleCallback({
      code: req.query.code,
      state: req.query.state,
      req,
    });

    if (result.error) {
      const info = OAUTH_ERROR_RESPONSES[result.error];
      return res
        .status(info.status)
        .json({ success: false, error: { code: result.error, message: info.message } });
    }

    if (result.requiresLinkConfirmation) {
      return res.status(200).json({
        success: true,
        data: { requires_link_confirmation: true, link_pending_token: result.linkPendingToken },
      });
    }

    if (result.requiresBirthDate) {
      return res.status(200).json({
        success: true,
        data: {
          requires_birth_date: true,
          registration_pending_token: result.registrationPendingToken,
        },
      });
    }

    return finishOAuthLogin(result, res);
  } catch (err) {
    next(err);
  }
}

async function googleLinkConfirm(req, res, next) {
  try {
    const result = await authService.confirmGoogleLink({
      rawToken: req.validatedBody.link_pending_token,
      password: req.validatedBody.password,
      req,
    });

    if (result.error) {
      const messages = {
        ...OAUTH_ERROR_RESPONSES,
        INVALID_PASSWORD: { status: 401, message: 'Incorrect password.' },
        ALREADY_LINKED_ELSEWHERE: {
          status: 409,
          message: 'This Google account is already linked to another user.',
        },
      };
      const info = messages[result.error];
      return res
        .status(info.status)
        .json({ success: false, error: { code: result.error, message: info.message } });
    }

    return finishOAuthLogin(result, res);
  } catch (err) {
    next(err);
  }
}

async function googleRegisterConfirm(req, res, next) {
  try {
    const result = await authService.confirmGoogleRegistration({
      rawToken: req.validatedBody.registration_pending_token,
      birthDate: req.validatedBody.birth_date,
      req,
    });

    if (result.error) {
      const info = OAUTH_ERROR_RESPONSES[result.error] || {
        status: 400,
        message: 'Registration failed.',
      };
      return res
        .status(info.status)
        .json({ success: false, error: { code: result.error, message: info.message } });
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
      return res
        .status(info.status)
        .json({ success: false, error: { code: result.error, message: info.message } });
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
