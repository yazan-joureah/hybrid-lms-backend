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
 * POST /auth/account/restore/request*/
async function requestRestore(req, res, next) {
  try {
    await authService.requestAccountRestore({ email: req.validatedBody.email, req });

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
