const QRCode = require('qrcode');
const authService = require('../../services/authService');
const { issueSessionCookies } = require('../../utils/sessionCookies.util');

/** POST /auth/mfa/totp/setup — requires Bearer JWT. */
async function setupTotp(req, res, next) {
  try {
    const result = await authService.setupTotp({ userId: req.user.id, req });

    if (result.error) {
      return res.status(404).json({
        success: false,
        error: { code: result.error, message: 'User not found.' },
      });
    }

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

/** POST /auth/mfa/totp/verify — requires Bearer JWT. */
async function verifyTotp(req, res, next) {
  try {
    const result = await authService.confirmTotpSetup({
      userId: req.user.id,
      code: req.validatedBody.code,
      req,
    });

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

const MFA_LOGIN_VERIFY_ERROR_RESPONSES = {
  MFA_CHALLENGE_EXPIRED: {
    status: 401,
    message: 'MFA challenge has expired. Please log in again.',
  },
  MFA_CHALLENGE_INVALID: { status: 401, message: 'Invalid MFA challenge.' },
  INVALID_CODE: { status: 400, message: 'Invalid or expired code.' },
};

/**
 * POST /auth/mfa/login/verify — completes login after mfa_required=true.
 * DEVIATION: cookie-setting duplication with login.controller.js's login()
 * still stands here (5th occurrence) — flagged for a controller-level
 * cookie-helper pass if this keeps growing; not addressed in this split.
 */
async function verifyMfaLogin(req, res, next) {
  try {
    const result = await authService.completeMfaLogin({ ...req.validatedBody, req });

    if (result.error) {
      const info = MFA_LOGIN_VERIFY_ERROR_RESPONSES[result.error];
      return res.status(info.status).json({
        success: false,
        error: { code: result.error, message: info.message },
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

module.exports = { setupTotp, verifyTotp, verifyMfaLogin };
