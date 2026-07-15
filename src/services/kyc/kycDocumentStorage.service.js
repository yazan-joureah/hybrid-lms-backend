// src/services/kyc/kycDocumentStorage.service.js
//
// تنفيذ SF-KYC-02 — نسخة مُبسَّطة بعد قرار حذف فحص Antivirus (ClamAV).
//
// قرار تقني موثَّق: النطاق الأمني اقتصر على فحص Magic Bytes + الحجم +
// اتساق الامتداد (fileValidation.util.js) فقط. تم التخلي عمداً عن فحص
// المحتوى الخبيث المُضمَّن داخل ملفات سليمة البنية (Polyglot/Payload في
// Metadata)، لتقليل التعقيد التشغيلي (استقرار سحب صورة Docker لـ ClamAV،
// حجمها، تعقيد CI/CD الإضافي). الخطر المتبقي (Residual Risk) مقبول
// ومُوثَّق لمشروع تخرج غير معرَّض فعلياً لمهاجمين متقدمين.
//
// المراجع: FR-47 | OWASP File Upload Cheat Sheet (لا يزال Magic Bytes +
// الحجم + الامتداد يُطبَّق بالكامل — الجزء المتبقي من الحماية).

const { validateUploadedFile } = require('../../utils/fileValidation.util');
const { encryptForUser } = require('../../utils/crypto');
const KYCDocument = require('../../models/KYCDocument');
const auditService = require('../auditService');

/**
 * @param {object} params
 * @param {Buffer} params.buffer
 * @param {string} params.declaredFilename
 * @param {string} params.userId
 * @param {string} params.actorRole
 * @param {'national_id'|'passport'|'selfie'} params.documentType
 * @param {import('express').Request} params.req
 * @returns {Promise<{success: boolean, fileReference?: string, reason?: string}>}
 */
async function encryptAndStoreDocument({
  buffer,
  declaredFilename,
  userId,
  actorRole,
  documentType,
  req,
}) {
  // الخطوة 1: التحقق من التنسيق والحجم والـ Magic Bytes (فحص Antivirus
  // مُزال عمداً — راجع تعليق أعلى الملف)
  const validation = await validateUploadedFile(buffer, declaredFilename);
  if (!validation.valid) {
    await auditService.record({
      actorId: userId,
      actorRole,
      action: 'KYC_DOCUMENT_REJECTED_FORMAT',
      resourceType: 'KYCDocument',
      resourceId: userId,
      metadata: { reason: validation.reason, documentType },
      req,
    });
    return { success: false, reason: 'INVALID_FILE' };
  }

  // الخطوة 2: التشفير بمفتاح مشتق خاص بالمستخدم (FR-47)
  const encryptedContent = encryptForUser(buffer, userId);

  // الخطوة 3: التخزين
  const document = await KYCDocument.create({
    user_id: userId,
    document_type: documentType,
    encrypted_content: encryptedContent,
    detected_mime_type: validation.detectedMime,
  });

  // الخطوة 4: تسجيل العملية (FR-30)
  await auditService.record({
    actorId: userId,
    actorRole,
    action: 'KYC_DOCUMENT_STORED',
    resourceType: 'KYCDocument',
    resourceId: document.file_reference,
    metadata: { documentType },
    req,
  });

  return { success: true, fileReference: document.file_reference };
}

module.exports = {
  encryptAndStoreDocument,
};
