const authService = require('../../services/authService');
const { issueSessionCookies, clearSessionCookies } = require('../../utils/sessionCookies.util');
const { AppError } = require('../../middleware/errorHandler');
const { recordFailure, recordSuccess } = require('../../middleware/rateLimiter');
const { loginIdentifier } = require('../../utils/rateLimitIdentifiers');

const LOGIN_ERRORS = {
  INVALID_CREDENTIALS: { status: 401, message: 'Invalid email or password.' },
  ACCOUNT_LOCKED: {
    status: 423,
    message:
      'Account temporarily locked. Please try again in a few minutes or reset your password.',
  },
  EMAIL_NOT_VERIFIED: {
    status: 403,
    message: 'Please verify your email first.',
    clientData: { next_step: 'verify_email' },
  },
  GUARDIAN_PENDING: {
    status: 403,
    message: 'Waiting for guardian approval.',
    clientData: { next_step: 'guardian_pending' },
  },
  ACCOUNT_SUSPENDED: {
    status: 403,
    message: 'Your account has been suspended. Please contact support.',
  },
};

// POST /auth/login.
async function login(req, res, next) {
  try {
    const result = await authService.loginUser({ ...req.validatedBody, req });

    if (result.error) {
      // SECURITY: only a genuine wrong-credential guess (or hammering an
      // already-locked account) is charged against the Redis budget —
      // NIST SP 800-63B §3.2.2 throttles FAILED authentication attempts,
      // not every request. EMAIL_NOT_VERIFIED / GUARDIAN_PENDING /
      // ACCOUNT_SUSPENDED all imply the password was ALREADY correct
      // (SF-AUTH-04 runs before the account-status check, UC-AUTH-03
      // steps 2-3) — never charge those.
      if (result.error === 'INVALID_CREDENTIALS' || result.error === 'ACCOUNT_LOCKED') {
        await recordFailure(req, 'login', loginIdentifier);
      }

      const info = LOGIN_ERRORS[result.error];
      // دمج clientData الثابت (next_step) مع guardianManageToken الديناميكي
      // — نبني data فقط إذا كان في شي فعلاً، حتى ما نضيف {} فاضية لباقي
      // أخطاء اللوجن (INVALID_CREDENTIALS مثلاً) يلي ما إلها clientData أصلاً
      const clientData =
        info.clientData || result.guardianManageToken
          ? {
              ...info.clientData,
              ...(result.guardianManageToken && {
                guardian_manage_token: result.guardianManageToken,
              }),
            }
          : undefined;
      throw new AppError(info.status, result.error, info.message, clientData);
    }

    // SECURITY: credentials verified correctly here (whether MFA is
    // required next or not) — clear any near-miss hits so a mistyped
    // password earlier this session doesn't linger into the next window.
    await recordSuccess(req, 'login', loginIdentifier);

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

// POST /auth/logout
async function logout(req, res, next) {
  try {
    await authService.logoutUser({ sessionId: req.user.sessionId, req });
    clearSessionCookies(res);
    return res.status(200).json({ success: true, data: { message: 'Logged out successfully' } });
  } catch (err) {
    next(err);
  }
}
const REFRESH_ERRORS = {
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
      const info = REFRESH_ERRORS[result.error];
      throw new AppError(info.status, result.error, info.message);
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

// POST /resert-password
async function resetPassword(req, res, next) {
  try {
    const { email, code, new_password: newPassword } = req.validatedBody;
    const result = await authService.resetPassword({ email, code, newPassword, req });

    if (result.error) {
      const statusMap = { INVALID_CODE: 400, CODE_EXPIRED: 400, TOO_MANY_ATTEMPTS: 429 };
      const status = statusMap[result.error] || 400;
      return res.status(status).json({
        success: false,
        error: { code: result.error, message: 'Reset failed.' },
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
