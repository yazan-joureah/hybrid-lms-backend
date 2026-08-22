const express = require('express');
const multer = require('multer');
const router = express.Router();

const kycController = require('../controllers/kycController');
const { validateBody } = require('../middleware/validate');
const { requireAuth } = require('../middleware/authMiddleware');
const { rateLimit } = require('../middleware/rateLimiter');
const { createMemoryUpload } = require('../middleware/upload.util');
const { AppError } = require('../middleware/errorHandler');
const { KYC_DOCUMENT_POLICY } = require('../config/uploadPolicies');
const { kycSubmitSchema } = require('../validators/kycSchemas');

const kycUpload = createMemoryUpload(KYC_DOCUMENT_POLICY.maxFileSizeBytes, 2).fields([
  { name: 'id_document', maxCount: 1 },
  { name: 'selfie', maxCount: 1 },
]);

// Normalizes MulterError (no .statusCode) into ApiError before it reaches
// the central errorHandler, which would otherwise misreport it as a 500.
function handleUploadErrors(uploadMiddleware) {
  return (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return next(new AppError(400, err.code, 'File upload failed: ' + err.message));
      }
      if (err) return next(err);
      return next();
    });
  };
}

router.post(
  '/requests',
  requireAuth,
  rateLimit('kyc-submit', (req) => req.user.id),
  handleUploadErrors(kycUpload),
  validateBody(kycSubmitSchema),
  kycController.submit
);

module.exports = router;
