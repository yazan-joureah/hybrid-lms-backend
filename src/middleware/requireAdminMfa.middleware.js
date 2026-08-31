// src/middleware/requireAdminMfa.middleware.js
const User = require('../models/User');
const { AppError } = require('./errorHandler');

/**
 * يمنع أي Admin/SuperAdmin من الوصول لأي مسار تحت /admin/* قبل ما يفعّل
 * التحقق الثنائي (MFA). يجب أن يوضع بعد requireAuth مباشرة (يعتمد على
 * req.user.id). لا يؤثر على أي دور آخر لأنه فقط موجود على راوتر الإدارة.
 */
async function requireAdminMfa(req, res, next) {
  try {
    const user = await User.findById(req.user.id).select('role mfa_enabled');
    if (!user) {
      throw new AppError(401, 'TOKEN_INVALID', 'User no longer exists');
    }
    if ((user.role === 'Admin' || user.role === 'SuperAdmin') && !user.mfa_enabled) {
      throw new AppError(
        403,
        'MFA_REQUIRED',
        'Two-factor authentication (MFA) must be enabled before accessing the admin panel.'
      );
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireAdminMfa };
