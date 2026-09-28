const User = require('../../models/User');
const Session = require('../../models/Session');
const RefreshToken = require('../../models/RefreshToken');
const ExternalIdentity = require('../../models/ExternalIdentity');
const auditService = require('../auditService');

async function revokeAllSessionsAndOAuth({ userId, reason, triggeredByAdminId, req }) {
  const bumpResult = await User.updateOne({ _id: userId }, { $inc: { token_version: 1 } });

  if (bumpResult.matchedCount === 0) {
    return { error: 'USER_NOT_FOUND' };
  }

  await RefreshToken.updateMany(
    { user_id: userId, revoked_at: null },
    { $set: { revoked_at: new Date() } }
  );

  await Session.updateMany({ user_id: userId, status: 'active' }, { $set: { status: 'revoked' } });

  await ExternalIdentity.updateMany(
    { user_id: userId, revoked_at: null },
    { $set: { revoked_at: new Date() } }
  );

  await auditService.record({
    actorId: userId,
    actorRole: 'System',
    action: 'ALL_SESSIONS_AND_OAUTH_REVOKED',
    resourceType: 'user',
    resourceId: userId,
    metadata: { reason, triggered_by_admin_id: triggeredByAdminId || null },
    req,
  });

  return { error: null };
}

module.exports = { revokeAllSessionsAndOAuth };
