/**
 * AUTH controllers — thin layer: parse → call service → shape response.
 * No business logic here (MVCS discipline — see README.md).
 */
const QRCode = require('qrcode');
const mfaService = require('../services/auth/mfa.service');
const authService = require('../services/authService');
const oauthService = require('../services/auth/oauth.service');

const env = require('../config/env');
const {
  generateCsrfToken,
  setCsrfCookie,
  CSRF_COOKIE_NAME,
} = require('../middleware/csrfProtection');

async function register(req, res, next) {
  try {
    const result = await authService.registerUser(req.validatedBody, req);

    // Identical response shape whether or not the email already existed —
    // prevents User Enumeration (MUC-AUTH-04).
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

/**
 * GET /auth/guardian/approve — ⚠️ TEMPORARY BACKEND-ONLY PLACEHOLDER.
 * The real endpoint is a Frontend Route (HTML consent form) — out of
 * scope for this repo. Exists only so the backend team can verify a
 * token manually via curl/Postman before the frontend exists.
 * TODO: remove once Frontend team (Yazan Habib / Safa) ships the real page.
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

/**
 * POST /auth/login — UC-AUTH-03.
 * Source: REST_API_Contract_v1.2 Group 3.
 */
async function login(req, res, next) {
  try {
    const result = await authService.loginUser(req.validatedBody, req);

    if (result.error) {
      const info = LOGIN_ERROR_RESPONSES[result.error];
      const body = { success: false, error: { code: result.error, message: info.message } };
      if (info.nextStep) {
        body.data = { next_step: info.nextStep };
      }
      return res.status(info.status).json(body);
    }

    if (result.mfaRequired) {
      // No cookie, no access_token — the client is NOT authenticated yet.
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

    res.cookie('refresh_token', result.refreshTokenRaw, {
      httpOnly: true,
      secure: env.nodeEnv === 'production', // allow plain HTTP locally in dev/test
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken, env.nodeEnv === 'production');

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

/**
 * POST /auth/logout — requires Bearer JWT (authMiddleware.requireAuth).
 */
async function logout(req, res, next) {
  try {
    await authService.logoutUser({ sessionId: req.user.sessionId }, req);

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
    return res.status(200).json({
      success: true,
      data: { message: 'Logged out successfully' },
    });
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
    const result = await authService.refreshSession(
      { rawRefreshToken: req.cookies?.refresh_token },
      req
    );

    if (result.error) {
      const info = REFRESH_ERROR_RESPONSES[result.error];
      return res.status(info.status).json({
        success: false,
        error: { code: result.error, message: info.message },
      });
    }

    res.cookie('refresh_token', result.refreshTokenRaw, {
      httpOnly: true,
      secure: env.nodeEnv === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken, env.nodeEnv === 'production');

    return res.status(200).json({ success: true, data: { access_token: result.accessToken } });
  } catch (err) {
    next(err);
  }
}

async function forgotPassword(req, res, next) {
  try {
    await authService.forgotPassword(req.validatedBody, req);
    // Deliberately identical response whether the email existed or not.
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
    const result = await authService.resetPassword({ rawToken: token, newPassword }, req);

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
/**
 * GET /auth/verify-email
 * Source: REST_API_Contract_v1.2 Group 1.
 */
async function verifyEmail(req, res, next) {
  try {
    const rawToken = req.query.token;

    if (!rawToken || typeof rawToken !== 'string') {
      return res.status(400).json({
        success: false,
        error: { code: 'TOKEN_INVALID', message: 'Verification token is missing or invalid.' },
      });
    }

    const result = await authService.verifyEmail(rawToken, req);

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
 * POST /auth/mfa/totp/setup — requires Bearer JWT (requireAuth).
 * Self-designed contract (no official REST_API_Contract for Groups 5-8).
 */
async function setupTotp(req, res, next) {
  try {
    const result = await mfaService.setupTotp(req.user.id, req);

    if (result.error) {
      return res.status(404).json({
        success: false,
        error: { code: result.error, message: 'User not found.' },
      });
    }

    // QR image generation is a presentation concern — kept here in the
    // thin controller layer, not in mfa.service.js, which only deals in
    // the underlying otpauth:// URI (business data).
    const qrCodeDataUrl = await QRCode.toDataURL(result.provisioningUri);

    return res.status(200).json({
      success: true,
      data: {
        qr_code_data_url: qrCodeDataUrl,
        manual_entry_key: result.rawSecret,
        message: 'Scan the QR code, then confirm with POST /auth/mfa/totp/verify',
      },
    });
  } catch (err) {
    next(err);
  }
}

const TOTP_VERIFY_ERROR_RESPONSES = {
  NO_PENDING_SETUP: { status: 400, message: 'No pending TOTP setup found. Call setup first.' },
  ALREADY_ENABLED: { status: 409, message: 'MFA is already enabled for this account.' },
  INVALID_CODE: { status: 400, message: 'Invalid or expired code.' },
};

/**
 * POST /auth/mfa/totp/verify — requires Bearer JWT (requireAuth).
 */
async function verifyTotp(req, res, next) {
  try {
    const result = await mfaService.confirmTotpSetup(req.user.id, req.validatedBody.code, req);

    if (result.error) {
      const info = TOTP_VERIFY_ERROR_RESPONSES[result.error];
      return res.status(info.status).json({
        success: false,
        error: { code: result.error, message: info.message },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        message:
          'MFA enabled successfully. Save these backup codes — they will not be shown again.',
        backup_codes: result.backupCodes,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function googleConsent(req, res, next) {
  try {
    const url = await oauthService.getGoogleConsentUrl();
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

async function googleCallback(req, res, next) {
  try {
    const result = await oauthService.handleGoogleCallback({
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

  res.cookie('refresh_token', result.refreshTokenRaw, {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  const csrfToken = generateCsrfToken();
  setCsrfCookie(res, csrfToken, env.nodeEnv === 'production');

  return res.status(200).json({
    success: true,
    data: { access_token: result.accessToken, user: result.user },
  });
}

async function googleLinkConfirm(req, res, next) {
  try {
    const result = await oauthService.confirmGoogleLink({
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
    const result = await oauthService.confirmGoogleRegistration({
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
    const result = await oauthService.submitGoogleGuardianEmail({
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

/**
 * GET /auth/me — returns the current authenticated user's safe profile.
 * Added to close a gap discovered while integrating the Base44 frontend.
 */
async function getMe(req, res, next) {
  try {
    const userData = await authService.getUserProfile(req.user.id);
    return res.status(200).json({
      success: true,
      data: userData,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  register,
  verifyEmail,
  guardianApprovePagePlaceholder,
  guardianApprove,
  login,
  logout,
  refresh,
  forgotPassword,
  resetPassword,
  setupTotp,
  verifyTotp,
  googleConsent,
  googleCallback,
  googleLinkConfirm,
  googleRegisterConfirm,
  googleGuardianEmail,
  getMe,
};
