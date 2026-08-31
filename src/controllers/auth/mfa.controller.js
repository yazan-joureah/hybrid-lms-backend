const QRCode = require('qrcode');
const authService = require('../../services/authService');
const { issueSessionCookies } = require('../../utils/sessionCookies.util');
const { AppError } = require('../../middleware/errorHandler');
const { recordFailure, recordSuccess } = require('../../middleware/rateLimiter');
const {
  mfaLoginVerifyIdentifier,
  mfaTotpVerifyIdentifier,
} = require('../../utils/rateLimitIdentifiers');

// POST /auth/mfa/totp/setup
async function setupTotp(req, res, next) {
  try {
    const result = await authService.setupTotp({ userId: req.user.id, req });

    if (result.error) {
      throw new AppError(404, result.error, 'User not found.');
    }

    const qrCodeDataUrl = await QRCode.toDataURL(result.provisioningUri);

    return res.status(200).json({
      success: true,
      data: {
        qr_code_data_url: qrCodeDataUrl,
        manual_entry_key: result.rawSecret,
        message: 'Scan the QR code',
      },
    });
  } catch (err) {
    next(err);
  }
}

const TOTP_VERIFY_ERRORS = {
  NO_PENDING_SETUP: { status: 400, message: 'No pending TOTP setup found. Call setup first.' },
  ALREADY_ENABLED: { status: 409, message: 'MFA is already enabled for this account.' },
  INVALID_CODE: { status: 400, message: 'Invalid or expired code.' },
};

// POST /auth/mfa/totp/verify
async function verifyTotp(req, res, next) {
  try {
    const result = await authService.confirmTotpSetup({
      userId: req.user.id,
      code: req.validatedBody.code,
      req,
    });

    if (result.error) {
      // SECURITY: only INVALID_CODE is a genuine guessing failure.
      // NO_PENDING_SETUP / ALREADY_ENABLED are state errors, not guesses.
      if (result.error === 'INVALID_CODE') {
        await recordFailure(req, 'mfa-verify', mfaTotpVerifyIdentifier);
      }
      const info = TOTP_VERIFY_ERRORS[result.error];
      throw new AppError(info.status, result.error, info.message);
    }

    await recordSuccess(req, 'mfa-verify', mfaTotpVerifyIdentifier);

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

const MFA_LOGIN_VERIFY_ERRORS = {
  MFA_CHALLENGE_EXPIRED: {
    status: 401,
    message: 'MFA challenge has expired. Please log in again.',
  },
  MFA_CHALLENGE_INVALID: { status: 401, message: 'Invalid MFA challenge.' },
  INVALID_CODE: { status: 400, message: 'Invalid or expired code.' },
};

// POST /auth/mfa/login/verify
async function verifyMfaLogin(req, res, next) {
  try {
    const result = await authService.completeMfaLogin({ ...req.validatedBody, req });

    if (result.error) {
      // SECURITY: only INVALID_CODE is a genuine guessing failure against
      // the mfaTempToken axis. MFA_CHALLENGE_EXPIRED / _INVALID mean the
      // challenge token itself is stale/unknown — not a wrong-code guess.
      if (result.error === 'INVALID_CODE') {
        await recordFailure(req, 'mfa-login-verify', mfaLoginVerifyIdentifier);
      }
      const info = MFA_LOGIN_VERIFY_ERRORS[result.error];
      throw new AppError(info.status, result.error, info.message);
    }

    await recordSuccess(req, 'mfa-login-verify', mfaLoginVerifyIdentifier);

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

module.exports = { setupTotp, verifyTotp, verifyMfaLogin };
