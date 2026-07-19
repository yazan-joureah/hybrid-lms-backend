const User = require('../models/User');
const { AppError } = require('./errorHandler');

/**
 * Middleware to ensure the authenticated user has verified their identity (KYC)
 * and enabled Multi-Factor Authentication (MFA).
 * Must be used after authentication middleware (req.user must exist).
 */
async function requireVerifiedIdentity(req, res, next) {
  try {
    const userId = req.user.id;

    // Fetch user details to verify current security status
    const user = await User.findById(userId).select('kyc_status mfa_enabled');

    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User account does not exist.');
    }

    // Check KYC status
    if (user.kyc_status !== 'verified') {
      throw new AppError(
        403,
        'KYC_NOT_VERIFIED',
        'You must complete your identity verification (KYC) before performing this action.'
      );
    }

    // Check MFA status
    if (!user.mfa_enabled) {
      throw new AppError(
        403,
        'MFA_REQUIRED',
        'Multi-factor authentication (MFA) must be enabled to proceed.'
      );
    }

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = requireVerifiedIdentity;
