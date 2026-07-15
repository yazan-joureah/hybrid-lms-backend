const { z } = require('zod');
const { REJECTION_REASONS } = require('../services/kyc/kycReview.service');

// Text fields only — files are handled separately by multer, not Zod.
const kycSubmitSchema = z.object({
  idDocumentType: z.enum(['national_id', 'passport']),
});

const kycApproveSchema = z.object({
  documentBirthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'documentBirthDate must be ISO format YYYY-MM-DD')
    .refine(
      (val) => !Number.isNaN(new Date(val).getTime()),
      'documentBirthDate is not a valid date'
    ),
  optionalNote: z.string().trim().max(500).optional(),
});

const kycRejectSchema = z.object({
  rejectionReason: z.enum(REJECTION_REASONS),
});

module.exports = { kycSubmitSchema, kycApproveSchema, kycRejectSchema };
