// src/utils/fileValidation.util.js

const { fromBuffer } = require('file-type');

async function detectActualFileType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return null;
  }

  const detected = await fromBuffer(buffer);

  return detected || null;
}

function isExtensionConsistent(declaredFilename, detectedExt) {
  if (!declaredFilename || !detectedExt) return false;

  const declaredExt = declaredFilename.split('.').pop().toLowerCase();

  // jpg/jpeg are considered equivalent because file-type always returns "jpg"
  const normalizedDeclared = declaredExt === 'jpeg' ? 'jpg' : declaredExt;
  const normalizedDetected = detectedExt === 'jpeg' ? 'jpg' : detectedExt;

  return normalizedDeclared === normalizedDetected;
}

function validateFileSize(buffer, maxBytes) {
  return Buffer.isBuffer(buffer) && buffer.length > 0 && buffer.length <= maxBytes;
}
async function validateUploadedFile(buffer, declaredFilename, options) {
  const { allowedMimeTypes, maxFileSizeBytes } = options || {};

  if (!Array.isArray(allowedMimeTypes) || allowedMimeTypes.length === 0) {
    throw new Error(
      'validateUploadedFile: options.allowedMimeTypes is required and must be a non-empty array. ' +
        'Define a policy in src/config/uploadPolicies.js and pass it explicitly — no implicit default is provided.'
    );
  }
  if (typeof maxFileSizeBytes !== 'number' || maxFileSizeBytes <= 0) {
    throw new Error(
      'validateUploadedFile: options.maxFileSizeBytes is required and must be a positive number.'
    );
  }

  // Check 1: Size
  if (!validateFileSize(buffer, maxFileSizeBytes)) {
    return { valid: false, reason: 'FILE_SIZE_INVALID' };
  }

  // Check 2: Actual type via Magic Bytes
  const detected = await detectActualFileType(buffer);
  if (!detected) {
    return { valid: false, reason: 'FILE_TYPE_UNRECOGNIZED' };
  }

  if (!allowedMimeTypes.includes(detected.mime)) {
    return { valid: false, reason: 'FILE_TYPE_NOT_ALLOWED' };
  }

  // Check 3: Extension consistency (additional defense layer)
  if (!isExtensionConsistent(declaredFilename, detected.ext)) {
    return { valid: false, reason: 'EXTENSION_MISMATCH' };
  }

  return { valid: true, detectedMime: detected.mime, detectedExt: detected.ext };
}

module.exports = {
  validateUploadedFile,
  detectActualFileType,
  isExtensionConsistent,
};
