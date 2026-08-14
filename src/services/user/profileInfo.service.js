const User = require('../../models/User');
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
module.exports = { getUserProfile };
