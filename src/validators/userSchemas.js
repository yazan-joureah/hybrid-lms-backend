const { z } = require('zod');

// كل الحقول اختيارية (تحديث جزئي — partial update)، لكن الشكل صارم إن أُرسلت.
const updateProfileSchema = z.object({
  full_name: z.string().trim().min(2).max(100).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{7,15}$/, 'phone must be 7-15 digits, optionally prefixed with +')
    .optional()
    .or(z.literal('')), // يسمح بمسح الحقل عمداً
  bio: z.string().trim().max(500).optional().or(z.literal('')),
  birth_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'birth_date must be ISO format YYYY-MM-DD')
    .refine((val) => !Number.isNaN(new Date(val).getTime()), 'birth_date is not a valid date')
    .optional(),
});

module.exports = { updateProfileSchema };
