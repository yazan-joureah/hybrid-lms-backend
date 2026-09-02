const { requestAgeCorrection } = require('../../services/kycService');
const { AppError } = require('../../middleware/errorHandler');

async function requestCorrection(req, res, next) {
  try {
    const result = await requestAgeCorrection({
      userId: req.user.id,
      newBirthDate: req.validatedBody.birth_date,
      guardianEmail: req.validatedBody.guardian_email,
      req,
    });

    if (result.error) {
      const statusMap = {
        NOT_AGE_FLAGGED: 409,
        CORRECTION_ALREADY_PENDING: 409,
        GUARDIAN_EMAIL_SAME_AS_STUDENT: 400,
        ACCOUNT_NOT_ACTIVE: 403,
        USER_NOT_FOUND: 404,
      };
      throw new AppError(
        statusMap[result.error] || 400,
        result.error,
        'Age correction request failed.'
      );
    }

    return res.status(200).json({ success: true, data: {} });
  } catch (err) {
    return next(err);
  }
}

module.exports = { requestCorrection };
