// src/utils/fileValidation.util.js
//
// A shared utility for validating uploaded files (Shared Internal Utility).
// Used primarily in the KYC module (SF-KYC-02) and reusable later in
// SF-COURSE-02.
//
// Reference standard: OWASP File Upload Cheat Sheet
// https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
//
// file-type@16.5.4 (last CommonJS version) — Versions 17+ are pure ESM
// and cause ERR_REQUIRE_ESM in our environment.

// FIX: In v16, the method is exported as `fromBuffer`, not `fileTypeFromBuffer`
const { fromBuffer } = require('file-type');

/**
 * Function 1: Detect the actual type of the file via Magic Bytes.
 *
 * Security logic: We never trust the mimetype provided by multer/the client, because
 * it is just a value in the HTTP header fully controlled by the attacker
 * (Content-Type Header is 100% forgeable). Checking Magic Bytes reads the actual
 * first bytes of the file content itself — this prevents MUC-KYC-02 (uploading
 * a malicious file disguised with an image suffix).
 *
 * @param {Buffer} buffer - Raw file content
 * @returns {Promise<{mime: string, ext: string} | null>}
 */
async function detectActualFileType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return null;
  }

  // FIX: Use the correct method name for v16
  const detected = await fromBuffer(buffer);

  // Note: fromBuffer returns undefined if it does not recognize
  // the signature at all (e.g., normal text files) — this is intentional,
  // not an error, because any KYC document must be an image with a known signature.
  return detected || null;
}

/**
 * Function 2: Verify consistency of the declared extension with the actually detected type.
 *
 * Security logic: An additional layer of defense (Defense in Depth) — even if the
 * detected type is within the whitelist, we also verify that the extension sent
 * by the client (e.g., "id_card.png") logically matches the real signature.
 * Mismatch is a strong indicator of an attempt to bypass security, even if
 * the file is "safe" type-wise.
 *
 * @param {string} declaredFilename - Filename as received from the client
 * @param {string} detectedExt - Extension extracted from Magic Bytes
 * @returns {boolean}
 */
function isExtensionConsistent(declaredFilename, detectedExt) {
  if (!declaredFilename || !detectedExt) return false;

  const declaredExt = declaredFilename.split('.').pop().toLowerCase();

  // jpg/jpeg are considered equivalent because file-type always returns "jpg"
  const normalizedDeclared = declaredExt === 'jpeg' ? 'jpg' : declaredExt;
  const normalizedDetected = detectedExt === 'jpeg' ? 'jpg' : detectedExt;

  return normalizedDeclared === normalizedDetected;
}

/**
 * Function 3: Verify file size is within the allowed limit.
 *
 * Security logic: Prevent resource exhaustion attacks (Resource Exhaustion / DoS)
 * via uploading huge files. The default 5MB limit is reasonable for high-resolution
 * ID document images without being excessive (OWASP always recommends an
 * explicit limit — no limit = vulnerability).
 *
 * @param {Buffer} buffer
 * @param {number} maxBytes
 * @returns {boolean}
 */
function validateFileSize(buffer, maxBytes) {
  return Buffer.isBuffer(buffer) && buffer.length > 0 && buffer.length <= maxBytes;
}

// KYC settings (importable from calling files, and extensible later for
// other modules with different lists — e.g., COURSE will need mp4/pdf later)
const KYC_ALLOWED_MIME_TYPES = Object.freeze(['image/png', 'image/jpeg']);
const KYC_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Main exported function: Comprehensive validation of an uploaded file.
 *
 * This is the only function called by higher layers (kycDocumentStorage later).
 * It combines the three checks in a "Fail Fast" order — the cheapest check (size)
 * first before the computationally heavier Magic Bytes check, to avoid
 * wasting processing on files already rejected due to size.
 *
 * @param {Buffer} buffer - File content
 * @param {string} declaredFilename - Name as sent by the client
 * @param {object} options
 * @param {string[]} options.allowedMimeTypes - The whitelist for this context
 * @param {number} options.maxFileSizeBytes - The max limit for this context
 * @returns {Promise<{valid: boolean, reason?: string, detectedMime?: string}>}
 */
async function validateUploadedFile(buffer, declaredFilename, options = {}) {
  const allowedMimeTypes = options.allowedMimeTypes || KYC_ALLOWED_MIME_TYPES;
  const maxFileSizeBytes = options.maxFileSizeBytes || KYC_MAX_FILE_SIZE_BYTES;

  // Check 1: Size
  if (!validateFileSize(buffer, maxFileSizeBytes)) {
    return { valid: false, reason: 'FILE_SIZE_INVALID' };
  }

  // Check 2: Actual type via Magic Bytes
  const detected = await detectActualFileType(buffer);
  if (!detected) {
    // No known signature at all → reject immediately, without revealing technical details to the client
    // (Prevents OWASP A10 — information leakage via error messages)
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
  KYC_ALLOWED_MIME_TYPES,
  KYC_MAX_FILE_SIZE_BYTES,
};
