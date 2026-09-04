const { z } = require('zod');

// UC-AI-02 / UC-AI-05 — رسالة المستخدم للمساعد. حد الطول طبقة دفاع أولى
// (Zod)؛ sanitizeForLLM في promptInjection.util.js يفرض حداً إضافياً
// بصرف النظر عما وصل هنا، تحسباً لأي مسار مستقبلي يتجاوز هذا الـ Schema.
const aiMessageSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, 'الرسالة مطلوبة')
    .max(2000, 'الرسالة تتجاوز الحد المسموح (2000 حرف)'),
});

// UC-AI-06 — طلب ملخص الأداء، مع تركيز اختياري (مثال: "أداء الوحدة 3")
const aiPerformanceSummarySchema = z.object({
  focus: z.string().trim().max(500).optional(),
});

module.exports = { aiMessageSchema, aiPerformanceSummarySchema };
