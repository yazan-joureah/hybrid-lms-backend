// src/services/user/profilePicture.service.js
const User = require('../../models/User');
const { AppError } = require('../../middleware/errorHandler');
const { replaceImage } = require('../imageUpload.service');
const fileStorage = require('../fileStorage.service');
const { toObjectId } = require('../../utils/objectId.util');

/** Sets/replaces user's own profile picture */
async function setProfilePicture({ userId, file, req }) {
  const safeUserId = toObjectId(userId, 'userId');

  const user = await User.findById(safeUserId);
  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User account does not exist.');
  }

  const { storagePath } = await replaceImage({
    file,
    previousStoragePath: user.profile_picture_storage_path,
    userId: safeUserId,
    actorRole: user.role,
    req,
    metadata: { purpose: 'user_profile_picture' },
  });

  user.profile_picture_storage_path = storagePath;
  await user.save();

  return { success: true, data: { profile_picture_set: true } };
}

/** Streams any user's profile picture by ID */
async function streamProfilePicture({ userId }) {
  const safeUserId = toObjectId(userId, 'userId');
  const user = await User.findById(safeUserId).select('profile_picture_storage_path').lean();
  if (!user || !user.profile_picture_storage_path) {
    throw new AppError(404, 'IMAGE_NOT_FOUND', 'No profile picture set for this user.');
  }

  const fileId = user.profile_picture_storage_path.split('/').pop();
  const { stream, contentType, filename } = await fileStorage.getDownloadStream({ fileId });
  return { stream, contentType, filename };
}

module.exports = { setProfilePicture, streamProfilePicture };
