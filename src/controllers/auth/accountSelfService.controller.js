// src/controllers/auth/accountSelfService.controller.js
const authService = require('../../services/authService');
const { AppError } = require('../../middleware/errorHandler');

/** DELETE /auth/account — UC-AUTH-08.6, self-service (all roles). */
async function requestOwnDeletion(req, res, next) {
  try {
    const result = await authService.requestOwnAccountDeletion({
      userId: req.user.id,
      reason: req.validatedBody.reason,
      req,
    });

    // 200 للحذف الفوري (Student)، 202 Accepted للطلب المعلَّق مراجعة
    // (Instructor/Admin) — تمييز HTTP دقيق بين "تم" و"قيد الانتظار".
    return res.status(result.immediate ? 200 : 202).json({
      success: true,
      data: result.immediate
        ? { status: result.status }
        : { status: result.status, requestId: result.requestId },
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /auth/account/restore/request — step 1. Deliberately NOT behind
 * requireAuth: the account is 'deleted' and holds no valid session/JWT
 * to authenticate with — identical reasoning to forgotPassword.
 */
async function requestRestore(req, res, next) {
  try {
    await authService.requestAccountRestore({ email: req.validatedBody.email, req });

    // Same generic success message regardless of match/eligibility —
    // mirrors forgotPassword's anti-enumeration discipline (MUC-AUTH-02).
    return res.status(200).json({
      success: true,
      data: { message: 'If a deleted account matches this email, a restore code has been sent.' },
    });
  } catch (err) {
    return next(err);
  }
}

/** POST /auth/account/restore/confirm — step 2. Also public (see above). */
async function confirmRestore(req, res, next) {
  try {
    const result = await authService.confirmAccountRestore({
      email: req.validatedBody.email,
      code: req.validatedBody.code,
      req,
    });

    if (result.error) {
      throw new AppError(400, result.error, 'Could not restore the account.');
    }

    return res.status(200).json({ success: true, data: {} });
  } catch (err) {
    return next(err);
  }
}

module.exports = { requestOwnDeletion, requestRestore, confirmRestore };
