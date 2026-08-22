// src/services/fileStorage.service.js

const mongoose = require('mongoose');
const { Readable } = require('stream');
const auditService = require('./auditService');
const { validateUploadedFile } = require('../utils/fileValidation.util');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const GRIDFS_BUCKET_NAME = 'course_files';

/** Uploads a validated file buffer to GridFS and records the audit trail. */
async function uploadFile({
  buffer,
  filename,
  mimeType,
  sizeBytes,
  userId,
  actorRole,
  req,
  metadata = {},
}) {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection not established');
  }

  const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: GRIDFS_BUCKET_NAME });

  const uploadStream = bucket.openUploadStream(filename, {
    contentType: mimeType,
    metadata: { ...metadata, uploadedBy: userId, uploadedAt: new Date(), sizeBytes },
  });

  await new Promise((resolve, reject) => {
    Readable.from(buffer).pipe(uploadStream).on('error', reject).on('finish', resolve);
  });

  await auditService.record({
    actorId: userId,
    actorRole,
    action: 'FILE_STORED_IN_GRIDFS',
    resourceType: 'GridFSFile',
    resourceId: uploadStream.id.toString(),
    metadata: { filename, mimeType, sizeBytes, bucket: GRIDFS_BUCKET_NAME, ...metadata },
    req,
  });

  return {
    fileId: uploadStream.id.toString(),
    storagePath: `gridfs://${GRIDFS_BUCKET_NAME}/${uploadStream.id}`,
  };
}

/** Deletes a file from GridFS (used when a CourseContent item is removed). */
async function deleteFile({ fileId, userId, actorRole, req }) {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection not established');
  }

  const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: GRIDFS_BUCKET_NAME });
  await bucket.delete(new mongoose.Types.ObjectId(fileId));

  await auditService.record({
    actorId: userId,
    actorRole,
    action: 'FILE_DELETED_FROM_GRIDFS',
    resourceType: 'GridFSFile',
    resourceId: fileId,
    req,
  });

  return { success: true };
}

// Opens a readable stream for a GridFS file by ID, for piping directly
//into an HTTP response.
async function getDownloadStream({ fileId }) {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection not established');
  }

  const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: GRIDFS_BUCKET_NAME });
  const objectId = new mongoose.Types.ObjectId(fileId);

  // Confirms the file actually exists before returning a stream — avoids
  const files = await bucket.find({ _id: objectId }).toArray();
  if (files.length === 0) {
    throw new Error('FILE_NOT_FOUND_IN_GRIDFS');
  }

  const stream = bucket.openDownloadStream(objectId);
  return {
    stream,
    contentType: files[0].contentType,
    filename: files[0].filename,
  };
}

// Safely deletes a file from GridFS — deletion failure (file already missing,
// temporary connection issues, etc.) must not stop the calling operation
// (update/delete of a resource).
async function safeDeleteFile({ fileId, userId, actorRole, req }) {
  try {
    await deleteFile({ fileId, userId, actorRole, req });
  } catch (err) {
    logger.error('File deletion failed (non-critical)', { fileId, error: err.message });
  }
}

async function replaceFile({
  file,
  previousStoragePath = null,
  allowedMimeTypes,
  maxFileSizeBytes,
  userId,
  actorRole,
  req,
  metadata = {},
}) {
  if (!file || !file.buffer) {
    throw new AppError(400, 'FILE_REQUIRED', 'A file is required.');
  }

  const validation = await validateUploadedFile(file.buffer, file.originalname, {
    allowedMimeTypes,
    maxFileSizeBytes,
  });
  if (!validation.valid) {
    throw new AppError(400, validation.reason, 'The uploaded file failed validation.');
  }

  const { fileId, storagePath } = await uploadFile({
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
    await safeDeleteFile({ fileId: previousFileId, userId, actorRole, req });
  }

  return {
    fileId,
    storagePath,
    detectedMime: validation.detectedMime,
    sizeBytes: file.buffer.length,
  };
}

module.exports = { uploadFile, deleteFile, getDownloadStream, safeDeleteFile, replaceFile };
