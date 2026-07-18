const authService = require('../../services/authService');
const { issueSessionCookies } = require('../../utils/sessionCookies.util');
const env = require('../../config/env');
const { CSRF_COOKIE_NAME } = require('../../middleware/csrfProtection');

const LOGIN_ERROR_RESPONSES = {
  INVALID_CREDENTIALS: { status: 401, message: 'Invalid email or password.' },
  ACCOUNT_LOCKED: {
    status: 423,
    message:
      'Account temporarily locked. Please try again in a few minutes or reset your password.',
  },
  EMAIL_NOT_VERIFIED: {
    status: 403,
    message: 'Please verify your email first.',
    nextStep: 'verify_email',
  },
  GUARDIAN_PENDING: {
    status: 403,
    message: 'Waiting for guardian approval.',
    nextStep: 'guardian_pending',
  },
  ACCOUNT_SUSPENDED: {
    status: 403,
    message: 'Your account has been suspended. Please contact support.',
  },
};

/** POST /auth/login — UC-AUTH-03. */
async function login(req, res, next) {
  try {
    const result = await authService.loginUser({ ...req.validatedBody, req });

    if (result.error) {
      const info = LOGIN_ERROR_RESPONSES[result.error];
      const body = { success: false, error: { code: result.error, message: info.message } };
      if (info.nextStep) {
        body.data = { next_step: info.nextStep };
      }
      return res.status(info.status).json(body);
    }

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
      data: {
        access_token: result.accessToken,
        user: {
          role: result.user.role,
          mfa_enabled: result.user.mfaEnabled,
          kyc_status: result.user.kycStatus,
          redirect_to: result.user.redirectTo,
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

/** POST /auth/logout — requires Bearer JWT. */
async function logout(req, res, next) {
  try {
    await authService.logoutUser({ sessionId: req.user.sessionId, req });

    res.clearCookie('refresh_token', {
      httpOnly: true,
      secure: env.nodeEnv === 'production',
      sameSite: 'lax',
    });
    res.clearCookie(CSRF_COOKIE_NAME, {
      httpOnly: false,
      secure: env.nodeEnv === 'production',
      sameSite: 'lax',
    });
    return res.status(200).json({ success: true, data: { message: 'Logged out successfully' } });
  } catch (err) {
    next(err);
  }
}

const REFRESH_ERROR_RESPONSES = {
  TOKEN_MISSING: { status: 401, message: 'Refresh token is missing.' },
  TOKEN_INVALID: { status: 401, message: 'Refresh token is invalid, expired, or revoked.' },
  SESSION_REVOKED: { status: 403, message: 'Your password was changed. Please log in again.' },
};

async function refresh(req, res, next) {
  try {
    const result = await authService.refreshSession({
      rawRefreshToken: req.cookies?.refresh_token,
      req,
    });

    if (result.error) {
      const info = REFRESH_ERROR_RESPONSES[result.error];
      return res.status(info.status).json({
        success: false,
        error: { code: result.error, message: info.message },
      });
    }

    issueSessionCookies(res, result.refreshTokenRaw);
    return res.status(200).json({ success: true, data: { access_token: result.accessToken } });
  } catch (err) {
    next(err);
  }
}

async function forgotPassword(req, res, next) {
  try {
    await authService.forgotPassword({ ...req.validatedBody, req });
    return res.status(200).json({
      success: true,
      data: { message: 'If this email exists, a reset link has been sent' },
    });
  } catch (err) {
    next(err);
  }
}

const RESET_PASSWORD_ERROR_RESPONSES = {
  TOKEN_INVALID: 'This reset link is invalid.',
  TOKEN_ALREADY_USED: 'This reset link has already been used.',
  TOKEN_EXPIRED: 'This reset link has expired. Please request a new one.',
};

async function resetPassword(req, res, next) {
  try {
    const { token, new_password: newPassword } = req.validatedBody;
    const result = await authService.resetPassword({ rawToken: token, newPassword, req });

    if (result.error) {
      return res.status(400).json({
        success: false,
        error: { code: result.error, message: RESET_PASSWORD_ERROR_RESPONSES[result.error] },
      });
    }

    return res.status(200).json({
      success: true,
      data: { message: 'Password updated. All sessions have been terminated.' },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { login, logout, refresh, forgotPassword, resetPassword };
