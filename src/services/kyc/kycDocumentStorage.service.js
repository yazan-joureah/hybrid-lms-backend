// src/services/kyc/kycDocumentStorage.service.js
//
// تنفيذ SF-KYC-02 كاملاً — النسخة الصحيحة المطابقة لتوقيع
// auditService.record() الفعلي (actorId, actorRole, action, resourceType,
// resourceId, metadata, req).
//
// المراجع: FR-47 | MUC-KYC-02 (Malware Upload) | OWASP File Upload Cheat Sheet

const { validateUploadedFile } = require('../../utils/fileValidation.util');
const { checkFileForMalware } = require('./malwareScan.service');
const { encryptForUser } = require('../../utils/crypto');
const KYCDocument = require('../../models/KYCDocument');
const auditService = require('../auditService');

/**
 * @param {object} params
 * @param {Buffer} params.buffer
 * @param {string} params.declaredFilename
 * @param {string} params.userId
 * @param {string} params.actorRole - دور المستخدم من الـ JWT (Student/Instructor)
 * @param {'national_id'|'passport'|'selfie'} params.documentType
 * @param {import('express').Request} params.req - كائن الطلب الكامل لـ auditService
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
  // الخطوة 1: التحقق من التنسيق والحجم والـ Magic Bytes
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

  // الخطوة 2: فحص البرمجيات الخبيثة
  const scanResult = await checkFileForMalware(buffer, declaredFilename);

  if (scanResult.status === 'infected') {
    await auditService.record({
      actorId: userId,
      actorRole,
      action: 'KYC_MALICIOUS_UPLOAD_ATTEMPT',
      resourceType: 'KYCDocument',
      resourceId: userId,
      metadata: { documentType, viruses: scanResult.details },
      req,
    });
    return { success: false, reason: 'MALICIOUS_CONTENT_DETECTED' };
  }

  if (scanResult.status === 'scan_error') {
    await auditService.record({
      actorId: userId,
      actorRole,
      action: 'KYC_MALWARE_SCAN_UNAVAILABLE',
      resourceType: 'KYCDocument',
      resourceId: userId,
      metadata: { documentType },
      req,
    });
    return { success: false, reason: 'SCAN_TEMPORARILY_UNAVAILABLE' };
  }

  // الخطوة 3: التشفير بمفتاح مشتق خاص بالمستخدم (FR-47)
  const encryptedContent = encryptForUser(buffer, userId);

  // الخطوة 4: التخزين
  const document = await KYCDocument.create({
    user_id: userId,
    document_type: documentType,
    encrypted_content: encryptedContent,
    detected_mime_type: validation.detectedMime,
  });

  // الخطوة 5: تسجيل العملية (FR-30)
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
