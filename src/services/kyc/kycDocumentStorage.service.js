// src/services/kyc/kycDocumentStorage.service.js

const { validateUploadedFile } = require('../../utils/fileValidation.util');
const { encryptForUser } = require('../../utils/crypto');
const KYCDocument = require('../../models/KYCDocument');
const { KYC_DOCUMENT_POLICY } = require('../../config/uploadPolicies');
const auditService = require('../auditService');

async function encryptAndStoreDocument({
  buffer,
  declaredFilename,
  userId,
  actorRole,
  documentType,
  req,
}) {
  const validation = await validateUploadedFile(buffer, declaredFilename, KYC_DOCUMENT_POLICY);
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

  const encryptedContent = encryptForUser(buffer, userId);

  const document = await KYCDocument.create({
    user_id: userId,
    document_type: documentType,
    encrypted_content: encryptedContent,
    detected_mime_type: validation.detectedMime,
  });

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
