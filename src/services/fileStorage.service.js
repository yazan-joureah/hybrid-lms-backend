// src/services/fileStorage.service.js
/**
 * SF-COURSE-02 (storage layer): Generic file storage via MongoDB GridFS.
 * Used by COURSE ,LIVE.
 */
const mongoose = require('mongoose');
const { Readable } = require('stream');
const auditService = require('./auditService');

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

module.exports = { uploadFile, deleteFile };
