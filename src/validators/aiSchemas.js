const { z } = require('zod');

const aiMessageSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, 'الرسالة مطلوبة')
    .max(2000, 'الرسالة تتجاوز الحد المسموح (2000 حرف)'),
});

const aiPerformanceSummarySchema = z.object({
  focus: z.string().trim().max(500).optional(),
});

module.exports = { aiMessageSchema, aiPerformanceSummarySchema };
