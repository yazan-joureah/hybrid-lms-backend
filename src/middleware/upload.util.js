// src/middleware/upload.util.js
//
// مصنع Multer قابل لإعادة الاستخدام عبر الوحدات — وليس إعداداً واحداً
// ثابتاً، لأن أنواع الملفات المستقبلية (فيديو/PDF في COURSE وLIVE) تحتاج
// استراتيجية تخزين مختلفة جذرياً عن صور KYC الصغيرة.
//
// المرجع: OWASP File Upload Cheat Sheet — حد صريح للحجم إلزامي دائماً،
// واستراتيجية التخزين يجب أن تُناسب الحجم المتوقَّع (buffer كامل بالذاكرة
// خطر حقيقي لملفات كبيرة — DoS عبر استنزاف الذاكرة).
//
// حالياً: createMemoryUpload() فقط — لملفات صغيرة (KYC ≤5MB) حيث نحتاج
// Buffer مباشرة لفحص Magic Bytes. دالة مقابلة لتخزين القرص/التدفق
// للفيديوهات الكبيرة تُبنى لاحقاً عند الوصول فعلياً لوحدة COURSE/LIVE،
// وليس تخميناً الآن.

const multer = require('multer');

/**
 * @param {number} maxFileSizeBytes - حد صريح إلزامي، لا قيمة افتراضية مخفية
 * @param {number} maxFileCount - عدد الملفات الأقصى في الطلب الواحد
 * @returns {import('multer').Multer}
 */
function createMemoryUpload(maxFileSizeBytes, maxFileCount) {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxFileSizeBytes,
      files: maxFileCount,
    },
    // ملاحظة: لا فلترة نوع هنا عبر fileFilter (الذي يعتمد على mimetype
    // القادم من العميل — قابل للتزوير بالكامل). الفلترة الحقيقية عبر
    // Magic Bytes تحدث لاحقاً في fileValidation.util.js، وليس هنا.
  });
}

module.exports = { createMemoryUpload };
