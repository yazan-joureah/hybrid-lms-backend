const { submitKycRequest } = require('../../services/kycService');
const { ApiError } = require('../../middleware/errorHandler');

async function submit(req, res, next) {
  try {
    const idFile = req.files?.id_document?.[0];
    const selfieFile = req.files?.selfie?.[0];

    if (!idFile || !selfieFile) {
      throw new ApiError(400, 'MISSING_FILES', 'Both id_document and selfie files are required.');
    }

    const result = await submitKycRequest({
      userId: req.user.id,
      idDocumentType: req.validatedBody.idDocumentType,
      idDocumentFile: { buffer: idFile.buffer, filename: idFile.originalname },
      selfieFile: { buffer: selfieFile.buffer, filename: selfieFile.originalname },
      req,
    });

    if (!result.success) {
      throw new ApiError(400, result.reason, 'Your KYC submission could not be processed.');
    }

    return res
      .status(201)
      .json({ success: true, data: { message: 'KYC request submitted for review.' } });
  } catch (err) {
    return next(err);
  }
}

module.exports = { submit };
