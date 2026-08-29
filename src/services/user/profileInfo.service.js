const User = require('../../models/User');
const auditService = require('../auditService');
const { AppError } = require('../../middleware/errorHandler');
const { toObjectId } = require('../../utils/objectId.util');

//GET /user/me.
async function getUserProfile({ userId }) {
  const safeUserId = toObjectId(userId, 'userId');
  const user = await User.findById(safeUserId).select(
    'full_name email role status kyc_status mfa_enabled birth_date created_at profile_picture_storage_path'
  );

  if (!user) {
    throw new AppError(401, 'TOKEN_INVALID', 'User no longer exists');
  }

  return {
    id: user._id,
    full_name: user.full_name,
    email: user.email,
    role: user.role,
    status: user.status,
    kyc_status: user.kyc_status,
    mfa_enabled: user.mfa_enabled,
    birth_date: user.birth_date,
    created_at: user.created_at,
    profile_picture_storage_path: user.profile_picture_storage_path,
  };
}

/** PATCH /users/me — updates the caller's own profile fields only. */
async function updateUserProfile({ userId, updates, req }) {
  const safeUserId = toObjectId(userId, 'userId');
  const user = await User.findById(safeUserId);

  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User account does not exist.');
  }

  const changedFields = [];

  if (updates.full_name !== undefined) {
    user.full_name = updates.full_name;
    changedFields.push('full_name');
  }

  if (updates.phone !== undefined) {
    user.phone = updates.phone;
    changedFields.push('phone');
  }

  if (updates.bio !== undefined) {
    user.bio = updates.bio;
    changedFields.push('bio');
  }

  if (updates.birth_date !== undefined) {
    // SECURITY: birth_date is locked once KYC has verified it, to prevent
    // a post-verification mismatch with the reviewed ID document.
    if (user.kyc_status === 'verified') {
      throw new AppError(
        403,
        'BIRTH_DATE_LOCKED',
        'Birth date cannot be changed after identity verification (KYC).'
      );
    }
    user.birth_date = new Date(updates.birth_date);
    changedFields.push('birth_date');
  }

  await user.save();

  await auditService.record({
    actorId: user._id,
    actorRole: user.role,
    action: 'PROFILE_UPDATED',
    resourceType: 'user',
    resourceId: user._id,
    metadata: { changed_fields: changedFields },
    req,
  });

  return {
    id: user._id,
    full_name: user.full_name,
    email: user.email,
    phone: user.phone,
    bio: user.bio,
    birth_date: user.birth_date,
  };
}

module.exports = { getUserProfile, updateUserProfile };
