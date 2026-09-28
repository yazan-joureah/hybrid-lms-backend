// src/middleware/upload.util.js

const multer = require('multer');

function createMemoryUpload(maxFileSizeBytes, maxFileCount) {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxFileSizeBytes,
      files: maxFileCount,
    },
  });
}

module.exports = { createMemoryUpload };
