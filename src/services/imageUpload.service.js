// src/services/imageUpload.service.js
const { replaceFile } = require('./fileStorage.service');
const { IMAGE_POLICY } = require('../config/uploadPolicies');

async function replaceImage({ file, previousStoragePath, userId, actorRole, req, metadata = {} }) {
  const { storagePath } = await replaceFile({
    file,
    previousStoragePath,
    ...IMAGE_POLICY,
    userId,
    actorRole,
    req,
    metadata,
  });
  return { storagePath };
}

module.exports = { replaceImage };
