const User = require('../models/User');
const { AppError } = require('./errorHandler');

//For Services
async function assertIdentityVerified(userId) {
  const user = await User.findById(userId).select('kyc_status mfa_enabled');

  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User account does not exist.');
  }

  if (user.kyc_status !== 'verified') {
    throw new AppError(
      403,
      'KYC_NOT_VERIFIED',
      'You must complete your identity verification (KYC) before performing this action.'
    );
  }

  if (!user.mfa_enabled) {
    throw new AppError(
      403,
      'MFA_REQUIRED',
      'Multi-factor authentication (MFA) must be enabled to proceed.'
    );
  }

  return user;
}

// For Routes
async function requireVerifiedIdentity(req, res, next) {
  try {
    await assertIdentityVerified(req.user.id);
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = requireVerifiedIdentity;
module.exports.assertIdentityVerified = assertIdentityVerified;
