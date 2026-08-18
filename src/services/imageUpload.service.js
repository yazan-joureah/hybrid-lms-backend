// src/services/imageUpload.service.js
const { validateUploadedFile } = require('../utils/fileValidation.util');
const fileStorage = require('./fileStorage.service');
const { AppError } = require('../middleware/errorHandler');

const IMAGE_MIME_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
const IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Validates and uploads an image file, deleting the previous one.
 */
async function replaceImage({ file, previousStoragePath, userId, actorRole, req, metadata = {} }) {
  if (!file || !file.buffer) {
    throw new AppError(400, 'FILE_REQUIRED', 'An image file is required.');
  }

  const validation = await validateUploadedFile(file.buffer, file.originalname, {
    allowedMimeTypes: IMAGE_MIME_TYPES,
    maxFileSizeBytes: IMAGE_MAX_SIZE_BYTES,
  });
  if (!validation.valid) {
    throw new AppError(400, validation.reason, 'The uploaded image failed validation.');
  }

  const { storagePath } = await fileStorage.uploadFile({
    buffer: file.buffer,
    filename: file.originalname,
    mimeType: validation.detectedMime,
    sizeBytes: file.buffer.length,
    userId,
    actorRole,
    req,
    metadata,
  });

  if (previousStoragePath) {
    const previousFileId = previousStoragePath.split('/').pop();
    await fileStorage
      .deleteFile({ fileId: previousFileId, userId, actorRole, req })
      .catch(() => {});
  }

  return { storagePath };
}

module.exports = { replaceImage };
